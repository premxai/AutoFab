"""The team: Architect -> PartDesigners (parallel) -> Assembler, with up to 3 attempts per order.
Every artifact is a Blueprint (docs/CONTRACTS.md §2); the inspector decides, never the agents.
`run_order` is the unit of work: one order, one version (snapshot), returns a ChipRun (§7)."""
import asyncio, json, os, time
from . import inspector as insp
from .client import call

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLUEPRINT_SCHEMA = json.load(open(os.path.join(ROOT, "docs", "blueprint.schema.json"), encoding="utf-8"))
PLAN_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["definition_of_done", "parts"],
    "properties": {
        "definition_of_done": {"type": "array", "items": {"type": "string"}},
        "parts": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                  "required": ["name", "spec", "inputs", "outputs", "reuse"],
                  "properties": {"name": {"type": "string"}, "spec": {"type": "string"},
                                 "inputs": {"type": "array", "items": {"type": "string"}},
                                 "outputs": {"type": "array", "items": {"type": "string"}},
                                 "reuse": {"type": "string"}}}}}}
MAX_ATTEMPTS = 3
GATE_WORDS = "2-input AND, OR, XOR, NAND gates and 1-input NOT"


# ---------------------------------------------------------------- prompts (plain language; the schema does the format work)
def fab_prefix(ctx):
    """Byte-identical within a version: lessons index + library index first (stable), order last (changes)."""
    lib = ctx["library"]
    lines = ["You work in AutoFab, a chip fab run by a team of agents. Designs are checked on every possible input by an inspector that never trusts claims.",
             "LESSONS (read before you work):", lib.lessons_index(ctx.get("playbook")),
             "VERIFIED PARTS LIBRARY (reuse before designing):", lib.parts_index()]
    if ctx["flags"].get("fanout_buffer_rule"):
        lines.append("FAB RULE: no signal may drive more than 4 gate inputs; add a buffer (two NOTs) to split high fan-out.")
    if ctx["flags"].get("library_first"):
        lines.append("FAB RULE: if a library part covers a sub-function, instantiate it; do not rebuild it from gates.")
    return "\n".join(lines)


def messages(ctx, order, user_text):
    """stable_prefix=False (v1): the naive layout, order first in the system prompt -> the prefix changes every chip (cache misses).
    stable_prefix=True: the fab prefix (lessons + library) is the byte-identical system prompt; the order comes last."""
    if ctx["flags"].get("stable_prefix"):
        return [{"role": "system", "content": fab_prefix(ctx)}, {"role": "user", "content": order_text(order) + "\n\n" + user_text}]
    return [{"role": "system", "content": order_text(order) + "\n\n" + fab_prefix(ctx)}, {"role": "user", "content": user_text}]


def order_text(order):
    o = order
    t = [f"ORDER: {o['title']}", f"Spec: {o['spec']}", f"Inputs: {', '.join(o['inputs'])}. Outputs: {', '.join(o['outputs'])}.",
         f"Allowed gates: {', '.join(o['allowed_gates'])} (NOT has 1 input, all others exactly 2 inputs)."]
    if o.get("gate_budget"):
        t.append(f"Gate budget: at most {o['gate_budget']} gates.")
    if o.get("flipflops_allowed"):
        t.append("You may use D flip-flops (each has an input d and its output is the flip-flop's name); state starts at 0 and advances one clock per step.")
    return "\n".join(t)


def blueprint_instructions(schema_on):
    if schema_on:
        return "Hand in the blueprint: inputs, outputs (each output name -> the signal that drives it), instances of library parts with every port wired, gates, flipflops."
    return ('Reply only as JSON describing the circuit: {"inputs":[...],"outputs":{"<name>":"<signal>"},"instances":[{"name":..,"part":..,"wire":{port:signal}}],'
            '"gates":[{"name":..,"type":..,"inputs":[..],"output":..}],"flipflops":[{"name":..,"d":..}]}')


# ---------------------------------------------------------------- lenient coercion for v1 (no schema) answers
def coerce_blueprint(obj):
    """Best-effort mapping of free-form JSON into the Blueprint shape. Returns (blueprint, problems)."""
    if not isinstance(obj, dict):
        return None, ["not an object"]
    bp = {"inputs": obj.get("inputs") or [], "outputs": obj.get("outputs") or obj.get("output") or {},
          "instances": obj.get("instances") or [], "gates": [], "flipflops": obj.get("flipflops") or []}
    if isinstance(bp["outputs"], str):
        bp["outputs"] = {bp["outputs"]: bp["outputs"]}
    if isinstance(bp["outputs"], list):
        bp["outputs"] = {o: o for o in bp["outputs"] if isinstance(o, str)}
    problems = []
    for g in obj.get("gates") or obj.get("cells") or obj.get("circuit") or []:
        if not isinstance(g, dict):
            problems.append("gate entry is not an object"); continue
        typ = str(g.get("type") or g.get("op") or g.get("gate") or "").upper()
        ins = g.get("inputs") or g.get("ins") or g.get("in") or [v for k, v in g.items() if k in ("input", "input1", "input2", "in1", "in2", "a", "b")]
        if isinstance(ins, str):
            ins = [ins]
        out = g.get("output") or g.get("out") or g.get("name") or g.get("y")
        name = g.get("name") or out
        if not (typ and ins and out):
            problems.append(f"gate {name}: missing type/inputs/output"); continue
        bp["gates"].append({"name": str(name), "type": typ, "inputs": [str(i) for i in ins], "output": str(out)})
    for inst in bp["instances"]:
        if isinstance(inst, dict) and "wire" not in inst and "connections" in inst:
            inst["wire"] = inst.pop("connections")
    return bp, problems


# ---------------------------------------------------------------- the agents
async def architect(order, ctx, emit):
    r = ctx["routing"]["architect"]
    emit({"type": "spawn", "agent": "architect", "role": "architect", "model": r["model"]})
    msgs = messages(ctx, order, "You are the architect. Write the definition of done (the checks that must pass) and split the chip into parts: "
                    "for each part give a name, a one-sentence spec, its inputs and outputs, and `reuse` = the library part id that already implements it (or \"\" if none). "
                    "Small single-function chips are one part. Larger chips (adders, calculators) should be split into repeated parts." +
                    ("" if ctx["flags"]["schema_on"] else ' Reply only as JSON: {"definition_of_done":[...],"parts":[{"name":..,"spec":..,"inputs":[..],"outputs":[..],"reuse":".."}]}'))
    res = await call("architect", msgs, ctx["routing"], schema=PLAN_SCHEMA if ctx["flags"]["schema_on"] else None,
                     thinking=r.get("thinking", True), max_tokens=r.get("max_tokens", 20000),
                     loop_cutter=ctx["flags"].get("loop_cutter", False))
    ctx["calls"].append(res)
    plan = res.parsed if res.parsed else _lenient_json(res.content)
    if not isinstance(plan, dict) or not plan.get("parts"):
        plan = {"definition_of_done": ["all inputs correct", "every pin wired"],
                "parts": [{"name": "chip", "spec": order["spec"], "inputs": order["inputs"], "outputs": order["outputs"], "reuse": ""}]}
    emit({"type": "plan", "parts": [p["name"] for p in plan["parts"]], "definition_of_done": plan.get("definition_of_done", [])})
    return plan


async def design_part(part, order, ctx, emit, feedback=None):
    role = "designer_novel" if order["rung"] in (2, 3) else "designer"
    r = ctx["routing"][role]
    emit({"type": "spawn", "agent": f"designer:{part['name']}", "role": "designer", "model": r["model"]})
    reuse = part.get("reuse") or ""
    if reuse and reuse in ctx["library"].parts:
        p = ctx["library"].parts[reuse]
        return {"inputs": p["ports"]["inputs"], "outputs": {o: o for o in p["ports"]["outputs"]},
                "instances": [{"name": reuse, "part": reuse, "wire": {**{i: i for i in p["ports"]["inputs"]}, **{o: o for o in p["ports"]["outputs"]}}}],
                "gates": [], "flipflops": []}, None
    user = (f"You are designing the part `{part['name']}`: {part['spec']}\nPart inputs: {', '.join(part['inputs'])}. Part outputs: {', '.join(part['outputs'])}.\n"
            f"Use only {GATE_WORDS} and library parts. " + blueprint_instructions(ctx["flags"]["schema_on"]))
    if feedback:
        user += f"\n\nYour previous attempt failed inspection: {feedback['note']}\nFix only what is wrong. Previous blueprint: {json.dumps(feedback['blueprint'])[:4000]}"
    msgs = messages(ctx, order, user)
    res = await call(role, msgs, ctx["routing"], schema=BLUEPRINT_SCHEMA if ctx["flags"]["schema_on"] else None,
                     thinking=r.get("thinking", True), max_tokens=r.get("max_tokens", 12000),
                     loop_cutter=ctx["flags"].get("loop_cutter", False))
    ctx["calls"].append(res)
    if res.spiral or not res.content.strip():
        emit({"type": "spiral", "agent": f"designer:{part['name']}", "thinking_chars": res.thinking_chars, "note": "no answer within the budget"})
        return None, res
    bp = res.parsed if res.parsed else _lenient_json(res.content)
    if not ctx["flags"]["schema_on"]:
        bp, _ = coerce_blueprint(bp)
    return bp, res


async def assemble(order, plan, part_bps, ctx, emit, feedback=None):
    """Wire parts into the chip. One part -> it is the chip. Several -> ask the assembler for the top level."""
    if len(part_bps) == 1:
        return next(iter(part_bps.values())), None
    r = ctx["routing"]["assembler"]
    emit({"type": "spawn", "agent": "assembler", "role": "assembler", "model": r["model"]})
    ports = {n: {"inputs": p["inputs"], "outputs": p["outputs"]} for n, p in ((pp["name"], pp) for pp in plan["parts"])}
    user = ("You are the assembler. The parts below are built and verified; instantiate each one by its name as `part` and wire every port to a chip input, a chip output signal, or a signal from another part. "
            "You may add plain gates for glue. Parts and their ports:\n" + json.dumps(ports) + "\n" + blueprint_instructions(ctx["flags"]["schema_on"]))
    if feedback:
        user += f"\n\nYour previous assembly failed inspection: {feedback['note']}\nFix only what is wrong. Previous blueprint: {json.dumps(feedback['blueprint'])[:4000]}"
    msgs = messages(ctx, order, user)
    res = await call("assembler", msgs, ctx["routing"], schema=BLUEPRINT_SCHEMA if ctx["flags"]["schema_on"] else None,
                     thinking=r.get("thinking", True), max_tokens=r.get("max_tokens", 12000),
                     loop_cutter=ctx["flags"].get("loop_cutter", False))
    ctx["calls"].append(res)
    if res.spiral or not res.content.strip():
        emit({"type": "spiral", "agent": "assembler", "thinking_chars": res.thinking_chars, "note": "no answer within the budget"})
        return None, res
    bp = res.parsed if res.parsed else _lenient_json(res.content)
    if not ctx["flags"]["schema_on"]:
        bp, _ = coerce_blueprint(bp)
    return bp, res


# ---------------------------------------------------------------- one order, one version -> ChipRun
async def run_order(order, snapshot, library, run_id, learn=False, shift=0):
    """Returns a ChipRun (CONTRACTS §7). `library` is the Library object (frozen view in exam mode)."""
    t0 = time.time()
    events = []
    def emit(e):
        events.append({"t": round(time.time() - t0, 2), **e})
    ctx = {"library": library, "playbook": snapshot.get("playbook"), "flags": snapshot["flags"],
           "routing": snapshot["routing"], "calls": []}
    emit({"type": "order"})
    plan = await architect(order, ctx, emit)
    temp_parts = dict(library.parts)          # parts designed in this run, visible to the inspector
    feedback_by_part, asm_feedback, final_bp, inspection = {}, None, None, None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if attempt > 1:
            emit({"type": "retry", "attempt": attempt})
        # design parts in parallel (only parts without a verified blueprint yet, or whose feedback says they are wrong)
        todo = [p for p in plan["parts"] if p["name"] not in temp_parts or p["name"] in feedback_by_part]
        results = await asyncio.gather(*[design_part(p, order, ctx, emit, feedback_by_part.get(p["name"])) for p in todo])
        spiral = False
        for p, (bp, res) in zip(todo, results):
            if bp is None:
                spiral = True; continue
            temp_parts[p["name"]] = {"id": p["name"], "ports": {"inputs": p["inputs"], "outputs": p["outputs"]},
                                     "blueprint": bp, "verified": False, "gates": len(bp.get("gates", [])), "born_shift": shift}
            emit({"type": "place", "block": p["name"], "kind": "part", "label": p["name"].upper()[:6]})
        if spiral:
            inspection = _spiral_inspection(order, snapshot, attempt, ctx)
            emit({"type": "fail", "attempt": attempt, "category": "spiral", "note": inspection["note"], "bad_wires": [], "bad_blocks": []})
            continue
        bp, res = await assemble(order, plan, {p["name"]: temp_parts[p["name"]]["blueprint"] for p in plan["parts"]}, ctx, emit, asm_feedback)
        if bp is None:
            inspection = _spiral_inspection(order, snapshot, attempt, ctx)
            emit({"type": "fail", "attempt": attempt, "category": "spiral", "note": inspection["note"], "bad_wires": [], "bad_blocks": []})
            continue
        if ctx["flags"].get("tidy_tool") and bp and not bp.get("instances"):
            try:
                bp = {**bp, "gates": insp.tidy({"gates": bp.get("gates", []), "outputs": bp.get("outputs", {})})["gates"]}
            except Exception:
                pass
        _emit_wiring(bp, emit)
        inspection = insp.inspect(order, bp, temp_parts, snapshot["version"], attempt, _metrics(ctx))
        _emit_test(order, bp, temp_parts, inspection, attempt, emit)
        final_bp = bp
        if inspection["pass"]:
            emit({"type": "pass", "attempt": attempt})
            if learn:
                for p in plan["parts"]:
                    tp = temp_parts.get(p["name"])
                    if tp and not tp["verified"] and len(plan["parts"]) > 1:
                        library.add_part(p["name"], tp["ports"], tp["blueprint"], tp["gates"], shift)
            break
        emit({"type": "fail", "attempt": attempt, "category": inspection["failure_category"], "note": inspection["note"],
              "bad_wires": inspection.get("bad_wires", []), "bad_blocks": inspection.get("bad_blocks", [])})
        # route feedback: blocks named in bad_blocks -> their designers; otherwise the assembler (or the single part)
        bad = set(inspection.get("bad_blocks") or [])
        feedback_by_part = {n: {"note": inspection["note"], "blueprint": temp_parts[n]["blueprint"]} for n in bad if n in temp_parts}
        if not feedback_by_part:
            if len(plan["parts"]) == 1:
                n = plan["parts"][0]["name"]
                feedback_by_part = {n: {"note": inspection["note"], "blueprint": temp_parts[n]["blueprint"]}}
            else:
                asm_feedback = {"note": inspection["note"], "blueprint": bp}
    else:
        emit({"type": "human_ping", "note": f"{MAX_ATTEMPTS} attempts exhausted"})
    emit({"type": "done"})
    return {"run_id": run_id, "version": snapshot["version"], "order": {k: v for k, v in order.items() if k not in ("truth", "sequence", "best_known_gates")} | {"sequence": order.get("sequence")},
            "attempts": min(attempt, MAX_ATTEMPTS), "events": events, "blueprint": final_bp,
            "yosys_json": None, "inspection": inspection, "calls": [c.__dict__ for c in ctx["calls"]]}


# ---------------------------------------------------------------- helpers
def _lenient_json(text):
    s, e = text.find("{"), text.rfind("}")
    try:
        return json.loads(text[s:e + 1])
    except Exception:
        return None


def _metrics(ctx):
    cs = ctx["calls"]
    if not cs:
        return {}
    last = cs[-1]
    return {"model": last.model, "thinking": last.thinking, "tokens_in": sum(c.tokens_in for c in cs), "tokens_out": sum(c.tokens_out for c in cs),
            "thinking_chars": sum(c.thinking_chars for c in cs), "cached_tokens": sum((c.cached_tokens or 0) for c in cs),
            "cost_usd": round(sum(c.cost_usd for c in cs), 5), "time_s": round(sum(c.time_s for c in cs), 2),
            "ttft_s": next((c.ttft_s for c in cs if c.ttft_s is not None), None)}


def _spiral_inspection(order, snapshot, attempt, ctx):
    total = 2 ** len(order["inputs"]) if order.get("truth") else (order.get("sequence") or {}).get("steps", 0)
    return {"order_id": order["id"], "version": snapshot["version"], "attempt": attempt, "pass": False,
            "correct": {"ok": False, "passed": 0, "total": total},
            "rules": {k: "fail" if k == "format" else "ok" for k in ("format", "allowed_gates", "pins", "fanout", "depth", "unused", "budget")},
            "gates": 0, "best_known_gates": order.get("best_known_gates"), "depth": 0, "failure_category": "spiral",
            "note": "no answer within the thinking budget", "bad_wires": [], "bad_blocks": [], "metrics": _metrics(ctx)}


def _emit_wiring(bp, emit):
    for g in bp.get("gates", []):
        emit({"type": "place", "block": g["name"], "kind": "gate", "label": g["type"]})
    for inst in bp.get("instances", []):
        for port, sig in (inst.get("wire") or {}).items():
            emit({"type": "wire", "from": sig, "to": f"{inst['name']}.{port}"})
    for g in bp.get("gates", []):
        for i in g.get("inputs", []):
            emit({"type": "wire", "from": i, "to": f"{g['name']}.in"})


def _emit_test(order, bp, parts, inspection, attempt, emit):
    """One illustrative test for the stage: calculators get a + b, everything else the first failing or first vector."""
    try:
        flat = insp.flatten(bp, parts)
    except Exception:
        emit({"type": "test", "attempt": attempt, "inputs": {}, "expected": None, "got": None}); return
    if order["rung"] == 1 and order.get("truth"):
        n = sum(1 for i in order["inputs"] if i.startswith("a"))
        a, b = min(7, 2 ** n - 1), min(5, 2 ** n - 1)
        vec = {f"a{i}": (a >> i) & 1 for i in range(n)} | {f"b{i}": (b >> i) & 1 for i in range(n)}
        for extra in order["inputs"]:
            vec.setdefault(extra, 0)
        sig = insp.simulate(flat, vec)
        outs = [o for o in order["outputs"] if o.startswith("s")]
        got = sum((sig.get(bp["outputs"].get(o, o), 0) or 0) << i for i, o in enumerate(sorted(outs, key=lambda s: int(s[1:]))))
        emit({"type": "test", "attempt": attempt, "inputs": {"a": a, "b": b}, "expected": a + b if vec.get("op", 0) == 0 else a - b, "got": got})
    else:
        emit({"type": "test", "attempt": attempt, "inputs": {}, "expected": None, "got": None,
              "summary": f"{inspection['correct']['passed']}/{inspection['correct']['total']} inputs correct"})
