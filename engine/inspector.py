"""AutoFab inspector: the code that never trusts the agents.

Flattens a Blueprint (library instances -> gates), tests every input (or simulates the clocked
sequence), checks the hidden fab rules, scores, and writes a plain-English note with
`bad_wires` / `bad_blocks`.  Stdlib only.  Contracts: docs/CONTRACTS.md sections 2-4.

    from engine.inspector import inspect, flatten, simulate, fab_rules, tidy, FormatError
    python -m engine.inspector --selftest

The checking algorithms (norm / evaluate / check_comb / check_counter / flatten / check_assembly)
are ported from tools/spike_checker.py, which was verified against real Nemotron answers.  The one
structural change is that combinational orders are evaluated bit-parallel (every input vector at
once, packed into one Python int per signal), which gives the same answer as the spike's loop over
itertools.product but is fast enough to run the assembly-repair search below.

Conventions
  * order["inputs"][0] is the highest bit of a truth key ("0011" -> inputs[0]=0, inputs[3]=1).
  * "flat" = a Blueprint with `instances == []`; every flat gate/flip-flop name is prefixed with its
    instance path ("fa1.x1"); an instance's output port wire becomes the real signal name.
  * Rule values are "ok" | "fail"; rules that could not be evaluated (format failure) are "n/a".
  * Optional order keys honoured here: `max_depth` (default 12), `sequence.inputs` (per-step input
    dicts for sequential orders, default all zero).
"""
import copy
import json
import sys

GATE_TYPES = ("AND", "OR", "XOR", "NOT", "NAND")
MAX_FANOUT = 4
DEFAULT_MAX_DEPTH = 12
RULE_ORDER = ["format", "allowed_gates", "pins", "fanout", "depth", "unused", "budget"]
CARRY_PORTS = ("cin", "carry_in", "ci", "c_in", "carry")


class FormatError(Exception):
    """Blueprint is malformed (unknown part/port/type, wrong arity, duplicate names, ...).

    `str(e)` is a plain-English message.  `bad_blocks` / `bad_wires` follow CONTRACTS section 4.
    """

    def __init__(self, message, bad_wires=None, bad_blocks=None):
        super().__init__(message)
        self.message = message
        self.bad_wires = bad_wires or []
        self.bad_blocks = bad_blocks or []


# ----------------------------------------------------------------------------------------------
# normalisation (port of spike `norm`, tolerant of alternate key spellings)
# ----------------------------------------------------------------------------------------------
def _norm(bp):
    if not isinstance(bp, dict):
        raise FormatError("the blueprint is not a JSON object")
    gates = []
    for k, x in enumerate(bp.get("gates") or bp.get("cells") or []):
        if not isinstance(x, dict):
            raise FormatError(f"gate #{k + 1} is not an object")
        typ = str(x.get("type") or x.get("op") or "").upper()
        ins = x.get("inputs") or x.get("ins") or [v for kk, v in x.items() if kk in ("input", "input1", "input2", "in1", "in2")]
        if isinstance(ins, str):
            ins = [ins]
        out = x.get("output") or x.get("out") or x.get("name")
        name = x.get("name") or out
        if not out:
            raise FormatError(f"gate #{k + 1} has no output signal name")
        gates.append({"name": str(name), "type": typ, "inputs": [str(i) for i in ins], "output": str(out)})
    ffs = []
    for k, f in enumerate(bp.get("flipflops") or []):
        if not isinstance(f, dict):
            raise FormatError(f"flip-flop #{k + 1} is not an object")
        name = f.get("name") or f.get("q") or f.get("output")
        d = f.get("d") or f.get("input")
        if not name or not d:
            raise FormatError(f"flip-flop #{k + 1} needs a name and a d input")
        ffs.append({"name": str(name), "d": str(d)})
    outs = bp.get("outputs") if bp.get("outputs") is not None else bp.get("output")
    if isinstance(outs, str):
        outs = {outs: outs}
    if isinstance(outs, list):
        outs = {o: o for o in outs}
    if outs is not None and not isinstance(outs, dict):
        raise FormatError("'outputs' must map each output name to a signal")
    insts = []
    for k, i in enumerate(bp.get("instances") or []):
        if not isinstance(i, dict):
            raise FormatError(f"instance #{k + 1} is not an object")
        wire = i.get("wire") or i.get("connections") or {}
        if not isinstance(wire, dict):
            raise FormatError(f"instance {i.get('name')}: 'wire' must map ports to signals")
        insts.append({"name": str(i.get("name") or i.get("part")), "part": i.get("part"),
                      "wire": {str(p): str(s) for p, s in wire.items()}})
    inputs = bp.get("inputs") or []
    if isinstance(inputs, str):
        inputs = [inputs]
    return {"inputs": [str(i) for i in inputs], "outputs": {str(o): str(s) for o, s in (outs or {}).items()},
            "instances": insts, "gates": gates, "flipflops": ffs}


# ----------------------------------------------------------------------------------------------
# flatten (port of spike `flatten`, generalised to CONTRACTS section 3 parts and nesting)
# ----------------------------------------------------------------------------------------------
def _part_ports(part_id, part):
    try:
        ports = part["ports"]
        return list(ports["inputs"]), list(ports["outputs"])
    except (KeyError, TypeError):
        raise FormatError(f"library part '{part_id}' has no ports list")


def _resolve(alias, s):
    seen = set()
    while s in alias and s not in seen:
        seen.add(s)
        s = alias[s]
    return s


def _flatten(bp, library, cache=None, stack=()):
    """Returns (flat, info).  info = {"dangling_instance_inputs": [(inst, port, wire)], "dangling_gate_inputs": [(gate, sig)]}."""
    cache = {} if cache is None else cache
    bp = _norm(bp)
    library = library or {}
    inputs = bp["inputs"]
    if len(set(inputs)) != len(inputs):
        dup = sorted({i for i in inputs if inputs.count(i) > 1})
        raise FormatError(f"input name(s) {dup} listed twice")

    # unique element names
    seen = {}
    for kind, items in (("gate", bp["gates"]), ("instance", bp["instances"]), ("flip-flop", bp["flipflops"])):
        for it in items:
            if it["name"] in seen:
                raise FormatError(f"name '{it['name']}' is used twice (a {seen[it['name']]} and a {kind}); every name must be unique",
                                  bad_blocks=[it["name"]])
            seen[it["name"]] = kind

    # gate type / arity
    for g in bp["gates"]:
        if g["type"] not in GATE_TYPES:
            raise FormatError(f"gate {g['name']} has unknown type '{g['type']}' (use {', '.join(GATE_TYPES)})", bad_blocks=[g["name"]])
        want = 1 if g["type"] == "NOT" else 2
        if len(g["inputs"]) != want:
            raise FormatError(f"gate {g['name']} is {g['type']} but has {len(g['inputs'])} input(s); {g['type']} needs exactly {want}",
                              bad_blocks=[g["name"]])

    # signal drivers (collect for duplicate-driver detection)
    driver = {i: "primary input" for i in inputs}

    def claim(sig, who):
        if sig in driver:
            raise FormatError(f"signal '{sig}' is driven twice ({driver[sig]} and {who})", bad_blocks=[who.split(" ")[-1]])
        driver[sig] = who

    for g in bp["gates"]:
        claim(g["output"], f"gate {g['name']}")
    for f in bp["flipflops"]:
        claim(f["name"], f"flip-flop {f['name']}")

    flat_gates = [dict(g) for g in bp["gates"]]
    flat_ffs = [dict(f) for f in bp["flipflops"]]
    alias = {}
    inst_in = []          # (inst, port, wire) for every instance input port
    inst_out_wires = []   # wires driven by instance outputs

    for inst in bp["instances"]:
        pid = inst["part"]
        if pid not in library:
            raise FormatError(f"unknown part '{pid}' (instance {inst['name']})", bad_blocks=[inst["name"]])
        if pid in stack:
            raise FormatError(f"library part '{pid}' contains itself", bad_blocks=[inst["name"]])
        part = library[pid]
        in_ports, out_ports = _part_ports(pid, part)
        wire = inst["wire"]
        missing = [p for p in in_ports + out_ports if p not in wire]
        if missing:
            raise FormatError(f"{inst['name']} ({pid}): port(s) {missing} not wired", bad_blocks=[inst["name"]])
        extra = [p for p in wire if p not in in_ports and p not in out_ports]
        if extra:
            raise FormatError(f"{inst['name']} ({pid}) has no port named {extra} (ports: {in_ports + out_ports})", bad_blocks=[inst["name"]])
        if pid not in cache:
            try:
                cache[pid] = _flatten(part.get("blueprint"), library, cache, stack + (pid,))[0]
            except FormatError as e:
                raise FormatError(f"library part '{pid}' is broken: {e.message}", bad_blocks=[inst["name"]])
        fp = cache[pid]
        if set(fp["inputs"]) != set(in_ports):
            raise FormatError(f"library part '{pid}': blueprint inputs {fp['inputs']} do not match its ports {in_ports}", bad_blocks=[inst["name"]])
        pre = inst["name"] + "."
        rmap = {i: wire[i] for i in in_ports}
        for p in out_ports:
            s = fp["outputs"].get(p)
            if s is None:
                raise FormatError(f"library part '{pid}' does not define output '{p}'", bad_blocks=[inst["name"]])
            if s in rmap:  # pass-through of an input or a second port on the same internal signal
                alias[wire[p]] = rmap[s]
            else:
                rmap[s] = wire[p]
            claim(wire[p], f"instance {inst['name']}.{p}")
            inst_out_wires.append(wire[p])
        ren = lambda s, rmap=rmap, pre=pre: rmap.get(s, pre + s)
        for g in fp["gates"]:
            flat_gates.append({"name": pre + g["name"], "type": g["type"], "inputs": [ren(x) for x in g["inputs"]], "output": ren(g["output"])})
        for f in fp["flipflops"]:
            flat_ffs.append({"name": ren(f["name"]), "d": ren(f["d"])})
        for p in in_ports:
            inst_in.append((inst["name"], p, wire[p]))

    known = set(driver)
    if alias:
        for g in flat_gates:
            g["inputs"] = [_resolve(alias, i) for i in g["inputs"]]
            g["output"] = _resolve(alias, g["output"])
        for f in flat_ffs:
            f["d"] = _resolve(alias, f["d"])
    outputs = {}
    for o, s in bp["outputs"].items():
        if s not in known:
            raise FormatError(f"output '{o}' is mapped to '{s}', which does not exist", bad_wires=[[s, o]])
        outputs[o] = _resolve(alias, s)
    top_gate_names = {g["name"] for g in bp["gates"]}
    top_ff_names = {f["name"] for f in bp["flipflops"]}
    info = {
        "dangling_instance_inputs": [(i, p, w) for i, p, w in inst_in if w not in known],
        "dangling_gate_inputs": [(g["name"], s) for g in bp["gates"] for s in g["inputs"] if s not in known],
        "dangling_ff_inputs": [(f["name"], f["d"]) for f in bp["flipflops"] if f["d"] not in known],
    }
    flat = {"inputs": list(inputs), "outputs": outputs, "instances": [], "gates": flat_gates, "flipflops": flat_ffs}
    return flat, info


def flatten(blueprint, library):
    """Expand library instances into plain gates.  Raises FormatError(message) on any structural fault."""
    return _flatten(blueprint, library)[0]


# ----------------------------------------------------------------------------------------------
# evaluation (port of spike `evaluate`; bit-parallel so one int carries many input vectors)
# ----------------------------------------------------------------------------------------------
def _apply(typ, vals, mask):
    if typ == "NOT":
        return vals[0] ^ mask
    a, b = vals
    if typ == "AND":
        return a & b
    if typ == "OR":
        return a | b
    if typ == "XOR":
        return a ^ b
    if typ == "NAND":
        return (a & b) ^ mask
    raise KeyError(typ)


def _order_gates(flat):
    """Topological order of the gates that can be evaluated -> (ordered, unresolved)."""
    avail = set(flat.get("inputs") or []) | {f["name"] for f in flat.get("flipflops") or []}
    gates = flat.get("gates") or []
    waiting = {}
    consumers = {}
    ready = []
    for k, g in enumerate(gates):
        need = {i for i in g["inputs"] if i not in avail}
        waiting[k] = len(need)
        for i in need:
            consumers.setdefault(i, []).append(k)
        if not need:
            ready.append(k)
    ordered, done = [], set()
    while ready:
        k = ready.pop(0)
        g = gates[k]
        ordered.append(g)
        done.add(k)
        for c in consumers.get(g["output"], []):
            waiting[c] -= len({i for i in gates[c]["inputs"] if i == g["output"]})
            if waiting[c] == 0 and c not in done and c not in ready:
                ready.append(c)
    return ordered, [g for k, g in enumerate(gates) if k not in done]


def _run(ordered, sig, mask):
    for g in ordered:
        if g["type"] in GATE_TYPES:
            sig[g["output"]] = _apply(g["type"], [sig[i] for i in g["inputs"]], mask)
    return sig


def simulate(flat, inputs, state=None):
    """One combinational evaluation.  Returns {signal: 0/1} for inputs, flip-flop outputs and every gate that could be computed.

    `state` = {flip-flop name: value}; missing flip-flops read 0.  To clock a circuit, feed each
    flip-flop's `d` signal from the returned dict back in as its next state.
    """
    sig = {k: int(v) & 1 for k, v in (inputs or {}).items()}
    for f in flat.get("flipflops") or []:
        sig[f["name"]] = int((state or {}).get(f["name"], 0)) & 1
    return _run(_order_gates(flat)[0], sig, 1)


# ----------------------------------------------------------------------------------------------
# correctness (ports of spike `check_comb` / `check_counter`)
# ----------------------------------------------------------------------------------------------
def _fmt_bits(d):
    return " ".join(f"{k}={v}" for k, v in d.items())


def _check_comb(order, flat):
    ins = list(order["inputs"])
    n = len(ins)
    nvec = 1 << n
    full = (1 << nvec) - 1
    sig = {}
    for j, name in enumerate(ins):
        s = 1 << (n - 1 - j)
        sig[name] = (full // ((1 << (2 * s)) - 1)) * (((1 << s) - 1) << s)
    for f in flat["flipflops"]:
        sig[f["name"]] = 0
    _run(_order_gates(flat)[0], sig, full)
    outs = list(order["outputs"])
    exp = {o: 0 for o in outs}
    covered = 0
    for key, row in (order.get("truth") or {}).items():
        if len(key) != n or set(key) - {"0", "1"}:
            raise ValueError(f"truth key {key!r} does not match {n} inputs")
        v = int(key, 2)
        covered |= 1 << v
        for o in outs:
            if row.get(o):
                exp[o] |= 1 << v
    wrong = 0
    got = {}
    for o in outs:
        g = sig.get(flat["outputs"].get(o))
        got[o] = (exp[o] ^ full) if g is None else g
        wrong |= got[o] ^ exp[o]
    wrong &= covered
    total = covered.bit_count()
    res = {"ok": wrong == 0 and total > 0, "passed": total - wrong.bit_count(), "total": total, "first": None}
    if wrong:
        v = (wrong & -wrong).bit_length() - 1
        key = format(v, f"0{n}b")
        res["first"] = {"inputs": dict(zip(ins, map(int, key))),
                        "diff": {o: ((exp[o] >> v) & 1, (got[o] >> v) & 1 if sig.get(flat["outputs"].get(o)) is not None else None)
                                 for o in outs if (exp[o] ^ got[o]) >> v & 1}}
    return res


def _check_seq(order, flat):
    seq = order["sequence"]
    steps = int(seq["steps"])
    expected = seq["expected"]
    ordered = _order_gates(flat)[0]
    state = {f["name"]: 0 for f in flat["flipflops"]}
    passed = 0
    first = None
    for t in range(steps):
        sig = {i: 0 for i in order["inputs"]}
        if seq.get("inputs"):
            sig.update({k: int(v) & 1 for k, v in seq["inputs"][t].items()})
        sig.update(state)
        _run(ordered, sig, 1)
        want = expected[t]
        got = {o: sig.get(flat["outputs"].get(o)) for o in want}
        if all(got[o] == int(want[o]) for o in want):
            passed += 1
        elif first is None:
            first = {"step": t, "want": {o: int(v) for o, v in want.items()}, "got": got}
        state = {f["name"]: sig.get(f["d"], 0) for f in flat["flipflops"]}
    return {"ok": passed == steps and steps > 0, "passed": passed, "total": steps, "first": first}


def _check(order, flat):
    if order.get("sequence"):
        return _check_seq(order, flat)
    if order.get("truth") is None:
        raise ValueError("order has neither 'truth' nor 'sequence'")
    return _check_comb(order, flat)


# ----------------------------------------------------------------------------------------------
# fab rules
# ----------------------------------------------------------------------------------------------
def _rule_report(flat, order):
    """-> (rules, details, depth).  details[rule] = (message, bad_blocks)."""
    order = order or {}
    gates = flat["gates"]
    ffs = flat["flipflops"]
    det = {}
    rules = {r: "ok" for r in RULE_ORDER}

    def fail(rule, msg, blocks=()):
        if rules[rule] == "ok":
            rules[rule] = "fail"
            det[rule] = (msg, list(blocks))

    for g in gates:
        want = 1 if g["type"] == "NOT" else 2
        if g["type"] not in GATE_TYPES:
            fail("format", f"gate {g['name']} has unknown type '{g['type']}'", [g["name"]])
        elif len(g["inputs"]) != want:
            fail("format", f"gate {g['name']} ({g['type']}) has {len(g['inputs'])} input(s), needs {want}", [g["name"]])
    allowed = order.get("allowed_gates")
    if allowed is not None:
        al = {a.upper() for a in allowed}
        for g in gates:
            if g["type"] in GATE_TYPES and g["type"] not in al:
                fail("allowed_gates", f"gate {g['name']} is {g['type']}, which this order does not allow (allowed: {', '.join(sorted(al))})", [g["name"]])
    driven = set(flat["inputs"]) | {g["output"] for g in gates} | {f["name"] for f in ffs}
    for g in gates:
        for i in g["inputs"]:
            if i not in driven:
                fail("pins", f"gate {g['name']} reads '{i}', which nothing drives", [g["name"]])
    for f in ffs:
        if f["d"] not in driven:
            fail("pins", f"flip-flop {f['name']} has its d input on '{f['d']}', which nothing drives", [f["name"]])
    for o in order.get("outputs") or []:
        s = flat["outputs"].get(o)
        if s is None:
            fail("pins", f"output '{o}' is not mapped to any signal")
        elif s not in driven:
            fail("pins", f"output '{o}' is mapped to '{s}', which nothing drives")
    count = {}
    for g in gates:
        for i in g["inputs"]:
            count[i] = count.get(i, 0) + 1
    for f in ffs:
        count[f["d"]] = count.get(f["d"], 0) + 1
    producer = {g["output"]: g["name"] for g in gates}
    for s, c in count.items():
        if c > MAX_FANOUT:
            fail("fanout", f"signal '{s}' feeds {c} gate inputs (limit {MAX_FANOUT})", [producer[s]] if s in producer else [])
    ordered, _ = _order_gates(flat)
    dep = {s: 0 for s in list(flat["inputs"]) + [f["name"] for f in ffs]}
    for g in ordered:
        dep[g["output"]] = 1 + max([dep.get(i, 0) for i in g["inputs"]] or [0])
    depth = max(dep.values() or [0])
    limit = order.get("max_depth") or DEFAULT_MAX_DEPTH
    if depth > limit:
        deepest = max(ordered, key=lambda g: dep[g["output"]])
        fail("depth", f"longest path is {depth} gates deep (limit {limit}), ending at gate {deepest['name']}", [deepest["name"]])
    used = set(flat["outputs"].values()) | {f["d"] for f in ffs} | {i for g in gates for i in g["inputs"]}
    for g in gates:
        if g["output"] not in used:
            fail("unused", f"gate {g['name']} is never used (its output '{g['output']}' feeds nothing)", [g["name"]])
    for f in ffs:
        if f["name"] not in used:
            fail("unused", f"flip-flop {f['name']} is never used", [f["name"]])
    budget = order.get("gate_budget")
    if budget is not None and len(gates) > budget:
        fail("budget", f"uses {len(gates)} gates but the budget is {budget}")
    return rules, det, depth


def fab_rules(flat, order):
    """{"format","allowed_gates","pins","fanout","depth","unused","budget"} -> "ok" | "fail" for a flat blueprint."""
    return _rule_report(flat, order)[0]


# ----------------------------------------------------------------------------------------------
# tidy (dedupe identical gates, remove double NOT, drop dead gates)
# ----------------------------------------------------------------------------------------------
def tidy(flat):
    f = copy.deepcopy(flat)
    f.setdefault("instances", [])
    f.setdefault("flipflops", [])
    while True:
        changed = False
        ordered, unresolved = _order_gates(f)
        seq = ordered + unresolved
        alias, seen, not_src, removed = {}, {}, {}, set()
        for g in seq:
            g["inputs"] = [_resolve(alias, i) for i in g["inputs"]]
            if g["type"] == "NOT" and len(g["inputs"]) == 1 and g["inputs"][0] in not_src:
                alias[g["output"]] = not_src[g["inputs"][0]]
                removed.add(g["name"])
                continue
            key = (g["type"], tuple(sorted(g["inputs"])) if g["type"] != "NOT" else tuple(g["inputs"]))
            if key in seen:
                alias[g["output"]] = seen[key]
                removed.add(g["name"])
                continue
            seen[key] = g["output"]
            if g["type"] == "NOT" and len(g["inputs"]) == 1:
                not_src[g["output"]] = g["inputs"][0]
        if removed:
            changed = True
            f["gates"] = [g for g in f["gates"] if g["name"] not in removed]
            for ff in f["flipflops"]:
                ff["d"] = _resolve(alias, ff["d"])
            f["outputs"] = {o: _resolve(alias, s) for o, s in f["outputs"].items()}
        # dead-gate removal: keep only what feeds an output or a flip-flop
        prod = {g["output"]: g for g in f["gates"]}
        live, stack = set(), list(f["outputs"].values()) + [ff["d"] for ff in f["flipflops"]]
        while stack:
            s = stack.pop()
            if s in live:
                continue
            live.add(s)
            if s in prod:
                stack.extend(prod[s]["inputs"])
        keep = [g for g in f["gates"] if g["output"] in live]
        if len(keep) != len(f["gates"]):
            changed = True
            f["gates"] = keep
        if not changed:
            return f


# ----------------------------------------------------------------------------------------------
# assembly blame: which instance port is wired wrong?
# ----------------------------------------------------------------------------------------------
def _labels(bp, library):
    """wire name -> 'inst.port' for every wire driven by an instance output."""
    lab = {}
    for inst in bp["instances"]:
        part = library.get(inst["part"])
        if not part:
            continue
        try:
            _, outs = _part_ports(inst["part"], part)
        except FormatError:
            continue
        for p in outs:
            if p in inst["wire"]:
                lab[inst["wire"][p]] = f"{inst['name']}.{p}"
    return lab


def _wire_note(inst, port, cur, should, lab):
    what = "carry wire" if port.lower() in CARRY_PORTS else f"wire into port '{port}'"
    base = f"{what} into {inst} comes from {lab.get(cur, cur)}"
    return base + (f" (should be {lab.get(should, should)})" if should else "")


def _repair_search(order, bp, library, max_tries=4000):
    """Find one instance input port whose re-wiring to another signal makes the circuit fully correct.
    -> (inst_name, port, current_wire, fixed_wire) or None."""
    if len(order.get("inputs") or []) > 14:
        return None
    insts = bp["instances"]
    cache = {}
    tries = 0
    for idx, inst in enumerate(insts):
        part = library.get(inst["part"])
        if not part:
            continue
        in_ports, _ = _part_ports(inst["part"], part)
        for port in in_ports:
            cur = inst["wire"][port]
            cands = []
            for j in list(range(idx - 1, -1, -1)) + list(range(idx + 1, len(insts))):
                other = insts[j]
                op = library.get(other["part"])
                if op:
                    cands += [other["wire"][p] for p in _part_ports(other["part"], op)[1] if p in other["wire"]]
            cands += [g["output"] for g in bp["gates"]] + list(bp["inputs"]) + [f["name"] for f in bp["flipflops"]]
            own = {inst["wire"].get(p) for p in _part_ports(inst["part"], part)[1]}
            for cand in dict.fromkeys(cands):
                if cand == cur or cand in own:
                    continue
                tries += 1
                if tries > max_tries:
                    return None
                trial_insts = [dict(i, wire=dict(i["wire"])) for i in insts]
                trial_insts[idx]["wire"][port] = cand
                trial = dict(bp, instances=trial_insts)
                try:
                    flat = _flatten(trial, library, cache)[0]
                    if _check(order, flat)["ok"]:
                        return inst["name"], port, cur, cand
                except (FormatError, KeyError, ValueError):
                    continue
    return None


def _chain_heuristic(bp, library):
    """Fallback blame by structure: instances of one part form a chain (port p of stage k driven by an
    output of stage k-1).  The first later stage whose port is driven by something else is the suspect.
    -> (inst_name, port, current_wire, expected_wire) or None."""
    by_part = {}
    for inst in bp["instances"]:
        by_part.setdefault(inst["part"], []).append(inst)
    for pid, group in by_part.items():
        part = library.get(pid)
        if not part or len(group) < 3:
            continue
        in_ports, out_ports = _part_ports(pid, part)
        for port in in_ports:
            via = {}  # output port of the previous stage -> how many stages use it for `port`
            for k in range(1, len(group)):
                for op in out_ports:
                    if group[k]["wire"].get(port) == group[k - 1]["wire"].get(op):
                        via[op] = via.get(op, 0) + 1
            if not via:
                continue
            op, n = max(via.items(), key=lambda kv: kv[1])
            if n < 2:
                continue
            for k in range(1, len(group)):
                want = group[k - 1]["wire"][op]
                if group[k]["wire"].get(port) != want:
                    return group[k]["name"], port, group[k]["wire"].get(port), want
    return None


def _assembly_blame(order, bp, library, info, correct_ok):
    """-> (note, bad_wires, bad_blocks) or None when no instance port is to blame."""
    lab = _labels(bp, library)
    dang = info.get("dangling_instance_inputs") or []
    if dang:
        inst, port, w = dang[0]
        return (f"{inst}.{port} is wired to '{w}', which does not exist", [[w, f"{inst}.{port}"]], [inst])
    if correct_ok or not bp["instances"]:
        return None
    hit = _repair_search(order, bp, library) or _chain_heuristic(bp, library)
    if not hit:
        return None
    inst, port, cur, should = hit
    return (_wire_note(inst, port, cur, should, lab), [[lab.get(cur, cur), f"{inst}.{port}"]], [inst])


# ----------------------------------------------------------------------------------------------
# inspect
# ----------------------------------------------------------------------------------------------
def _describe_wrong(order, res):
    f = res["first"]
    if f is None:
        return "no test data to check against"
    if "step" in f:
        want = " ".join(f"{k}={v}" for k, v in f["want"].items())
        got = " ".join(f"{k}={v}" for k, v in f["got"].items())
        return (f"after {f['step']} clock(s) the outputs should be {want} but are {got} "
                f"({res['passed']}/{res['total']} steps correct)")
    diffs = ", ".join(f"{o} should be {e} but is {'undriven' if g is None else g}" for o, (e, g) in f["diff"].items())
    return (f"wrong on {res['total'] - res['passed']} of {res['total']} inputs; first failing input {_fmt_bits(f['inputs'])}: {diffs}")


def inspect(order, blueprint, library, version, attempt, metrics):
    """Independently verify `blueprint` against `order`.  Returns an Inspection (CONTRACTS section 4)."""
    ins = {"order_id": order.get("id"), "version": version, "attempt": attempt, "pass": False,
           "correct": {"ok": False, "passed": 0, "total": 0},
           "rules": {r: "n/a" for r in RULE_ORDER}, "gates": 0, "best_known_gates": order.get("best_known_gates"),
           "depth": 0, "failure_category": "format", "note": "", "bad_wires": [], "bad_blocks": [],
           "metrics": copy.deepcopy(metrics) if metrics is not None else {}}
    try:
        total = (order["sequence"]["steps"] if order.get("sequence") else len(order["truth"]))
    except (KeyError, TypeError):
        total = 0
    ins["correct"]["total"] = total

    def format_fail(msg, wires=(), blocks=()):
        ins["rules"]["format"] = "fail"
        ins.update(failure_category="format", note=msg, bad_wires=[list(w) for w in wires], bad_blocks=list(blocks))
        return ins

    library = library or {}
    try:
        flat, info = _flatten(blueprint, library)
        bp = _norm(blueprint)
    except FormatError as e:
        return format_fail(e.message, e.bad_wires, e.bad_blocks)

    # blueprint-level format checks that need the order
    problems = []
    extra = [i for i in bp["inputs"] if i not in (order.get("inputs") or [])]
    if extra:
        problems.append((f"blueprint declares input(s) {extra} that the order does not have", [], []))
    for o in order.get("outputs") or []:
        if o not in bp["outputs"]:
            problems.append((f"order output '{o}' is not mapped to any signal", [], []))
    if bp["flipflops"] and not order.get("flipflops_allowed"):
        problems.append(("flip-flops are not allowed for this order", [], [f["name"] for f in bp["flipflops"]]))
    for g, s in info["dangling_gate_inputs"]:
        problems.append((f"gate {g} reads signal '{s}', which does not exist", [[s, g]], [g]))
    for f, s in info["dangling_ff_inputs"]:
        problems.append((f"flip-flop {f} reads signal '{s}', which does not exist", [[s, f]], [f]))
    _, unresolved = _order_gates(flat)
    defined = set(flat["inputs"]) | {g["output"] for g in flat["gates"]} | {f["name"] for f in flat["flipflops"]}
    tainted = {i for g in unresolved for i in g["inputs"] if i not in defined}  # undriven signals and everything they poison
    grew = True
    while grew:
        grew = False
        for g in unresolved:
            if g["output"] not in tainted and any(i in tainted for i in g["inputs"]):
                tainted.add(g["output"])
                grew = True
    loop = [g["name"] for g in unresolved if g["output"] not in tainted]
    if loop:
        problems.append((f"feedback loop without a flip-flop through gate(s) {', '.join(loop[:4])}", [], loop[:4]))

    rules, det, depth = _rule_report(flat, order)
    ins["gates"], ins["depth"] = len(flat["gates"]), depth
    if problems:
        rules["format"] = "fail"
    ins["rules"] = rules
    res = _check(order, flat)
    ins["correct"] = {"ok": res["ok"], "passed": res["passed"], "total": res["total"]}
    ins["pass"] = bool(res["ok"] and all(v == "ok" for v in rules.values()))

    # failure category: format -> wrong_logic -> assembly -> rules -> budget
    blame = _assembly_blame(order, bp, library, info, res["ok"])
    if problems or "format" in det:
        msg, wires, blocks = (problems[0] if problems else (det["format"][0], [], det["format"][1]))
        ins["rules"]["format"] = "fail"
        ins.update(failure_category="format", note=msg, bad_wires=wires, bad_blocks=blocks)
    elif blame:
        note, wires, blocks = blame
        ins.update(failure_category="assembly", note=note, bad_wires=wires, bad_blocks=blocks)
    elif not res["ok"]:
        ins.update(failure_category="wrong_logic", note=_describe_wrong(order, res))
    else:
        failing = [r for r in RULE_ORDER if rules[r] == "fail" and r != "budget"]
        if failing:
            msg, blocks = det[failing[0]]
            if len(failing) > 1:
                msg += f" (also failing: {', '.join(failing[1:])})"
            ins.update(failure_category="rules", note=msg, bad_blocks=blocks)
        elif rules["budget"] == "fail":
            ins.update(failure_category="budget", note=det["budget"][0])
        else:
            ins.update(failure_category="none", note="all inputs correct and every fab rule satisfied")
    return ins


# ----------------------------------------------------------------------------------------------
# selftest
# ----------------------------------------------------------------------------------------------
def _g(name, typ, ins, out=None):
    return {"name": name, "type": typ, "inputs": list(ins), "output": out or name}


def _bp(inputs, outputs, gates, instances=(), flipflops=()):
    return {"inputs": list(inputs), "outputs": dict(outputs), "instances": list(instances),
            "gates": list(gates), "flipflops": list(flipflops)}


def _comb_order(oid, inputs, outputs, fn, allowed=("AND", "OR", "XOR", "NOT"), budget=None):
    import itertools
    truth = {}
    for bits in itertools.product([0, 1], repeat=len(inputs)):
        truth["".join(map(str, bits))] = fn(dict(zip(inputs, bits)))
    return {"id": oid, "pool": "practice", "rung": 2, "title": oid, "spec": "", "inputs": list(inputs), "outputs": list(outputs),
            "allowed_gates": list(allowed), "gate_budget": budget, "flipflops_allowed": False, "truth": truth, "sequence": None,
            "best_known_gates": None, "seed": 0}


def _selftest():
    results = []

    def check(name, cond, detail=""):
        results.append(bool(cond))
        print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))

    def run(order, bp, lib=None, attempt=1):
        return inspect(order, bp, lib or {}, "v1", attempt, {"model": "selftest", "tokens_in": 1})

    def short(i):
        return f"{i['correct']['passed']}/{i['correct']['total']}, {i['gates']} gates, {i['failure_category']}"

    # ---- D: y = 1 for 0,2,3,7,8,9,13,14
    dset = {0, 2, 3, 7, 8, 9, 13, 14}
    d_in = ["a", "b", "c", "d"]
    order_d = _comb_order("D", d_in, ["y"], lambda v: {"y": int((v["a"] * 8 + v["b"] * 4 + v["c"] * 2 + v["d"]) in dset)})
    d8 = _bp(d_in, {"y": "g8"}, [
        _g("g1", "OR", ["b", "d"]), _g("g2", "OR", ["c", "d"]), _g("g3", "XOR", ["a", "c"]), _g("g4", "NOT", ["g2"]),
        _g("g5", "AND", ["g3", "g2"]), _g("g6", "XOR", ["g4", "g1"]), _g("g7", "XOR", ["g6", "d"]), _g("g8", "XOR", ["g5", "g7"])])
    i = run(order_d, d8)
    check("D: 8-gate design passes 16/16", i["pass"] and i["correct"] == {"ok": True, "passed": 16, "total": 16} and i["gates"] == 8, short(i))
    d_sop = _bp(d_in, {"y": "y"}, [
        _g("na", "NOT", ["a"]), _g("nb", "NOT", ["b"]), _g("nc", "NOT", ["c"]), _g("nd", "NOT", ["d"]),
        _g("r00", "OR", ["c", "nd"]), _g("r01", "AND", ["c", "d"]), _g("r11", "XOR", ["c", "d"]),
        _g("s00", "AND", ["na", "nb"]), _g("s01", "AND", ["na", "b"]), _g("s10", "AND", ["a", "nb"]), _g("s11", "AND", ["a", "b"]),
        _g("t0", "AND", ["s00", "r00"]), _g("t1", "AND", ["s01", "r01"]), _g("t2", "AND", ["s10", "nc"]), _g("t3", "AND", ["s11", "r11"]),
        _g("o1", "OR", ["t0", "t1"]), _g("o2", "OR", ["t2", "t3"]), _g("y", "OR", ["o1", "o2"])])
    i = run(order_d, d_sop)
    check("D: 18-gate sum-of-products design passes 16/16", i["pass"] and i["gates"] == 18, short(i))
    d_bad = copy.deepcopy(d8)
    d_bad["gates"][6]["type"] = "AND"
    i = run(order_d, d_bad)
    check("D: broken 8-gate design -> wrong_logic with first failing vector",
          not i["correct"]["ok"] and i["failure_category"] == "wrong_logic" and "first failing input" in i["note"], i["note"])

    # ---- E: 2-bit comparator
    e_in = ["a1", "a0", "b1", "b0"]
    order_e = _comb_order("E", e_in, ["gt", "eq", "lt"], lambda v: (lambda A, B: {"gt": int(A > B), "eq": int(A == B), "lt": int(A < B)})(v["a1"] * 2 + v["a0"], v["b1"] * 2 + v["b0"]))
    e13 = _bp(e_in, {"gt": "gt", "eq": "eq", "lt": "lt"}, [
        _g("x1", "XOR", ["a1", "b1"]), _g("x0", "XOR", ["a0", "b0"]), _g("e1", "NOT", ["x1"]), _g("e0", "NOT", ["x0"]),
        _g("nb1", "NOT", ["b1"]), _g("nb0", "NOT", ["b0"]), _g("t1", "AND", ["a1", "nb1"]), _g("t2", "AND", ["a0", "nb0"]),
        _g("t3", "AND", ["e1", "t2"]), _g("gt", "OR", ["t1", "t3"]), _g("eq", "AND", ["e1", "e0"]), _g("l", "OR", ["gt", "eq"]), _g("lt", "NOT", ["l"])])
    i = run(order_e, e13)
    check("E: 2-bit comparator, 3 outputs, passes 16/16", i["pass"] and i["gates"] == 13, short(i))

    # ---- H: 9-NAND full adder, NAND-only budget 9
    fa_in = ["a", "b", "cin"]
    order_h = _comb_order("H", fa_in, ["sum", "cout"], lambda v: {"sum": v["a"] ^ v["b"] ^ v["cin"], "cout": (v["a"] & v["b"]) | (v["cin"] & (v["a"] ^ v["b"]))},
                          allowed=("NAND",), budget=9)
    nand9 = _bp(fa_in, {"sum": "sum", "cout": "cout"}, [
        _g("n1", "NAND", ["a", "b"]), _g("n2", "NAND", ["a", "n1"]), _g("n3", "NAND", ["b", "n1"]), _g("n4", "NAND", ["n2", "n3"]),
        _g("n5", "NAND", ["n4", "cin"]), _g("n6", "NAND", ["n4", "n5"]), _g("n7", "NAND", ["cin", "n5"]),
        _g("sum", "NAND", ["n6", "n7"]), _g("cout", "NAND", ["n1", "n5"])])
    i = run(order_h, nand9)
    check("H: 9-NAND full adder passes with NAND-only budget 9", i["pass"] and i["gates"] == 9 and i["rules"]["budget"] == "ok", short(i))
    nand10 = copy.deepcopy(nand9)
    nand10["gates"].append(_g("extra", "AND", ["a", "b"]))
    i = run(order_h, nand10)
    check("H: a 10th AND gate is rejected as allowed_gates", not i["pass"] and i["rules"]["allowed_gates"] == "fail" and i["failure_category"] == "rules"
          and i["rules"]["budget"] == "fail", i["note"])
    nand10b = copy.deepcopy(nand9)
    nand10b["gates"].append(_g("extra", "NAND", ["a", "b"]))
    nand10b["gates"][-2]["name"] = "cout"
    nand10b["outputs"]["cout"] = "cout"
    nand10b["gates"].append(_g("e2", "NAND", ["extra", "extra"]))
    i = run(order_h, nand10b)
    check("H: 11 NANDs -> over budget (and unused extras flagged)", i["rules"]["budget"] == "fail" and not i["pass"], i["note"])

    # ---- F: 2-bit counter
    order_f = {"id": "F", "pool": "practice", "rung": 5, "title": "counter", "spec": "", "inputs": [], "outputs": ["q1", "q0"],
               "allowed_gates": ["AND", "OR", "XOR", "NOT"], "gate_budget": None, "flipflops_allowed": True, "truth": None,
               "sequence": {"steps": 4, "expected": [{"q1": 0, "q0": 0}, {"q1": 0, "q0": 1}, {"q1": 1, "q0": 0}, {"q1": 1, "q0": 1}]},
               "best_known_gates": None, "seed": 0}
    ctr = _bp([], {"q1": "q1", "q0": "q0"}, [_g("n0", "NOT", ["q0"]), _g("x1", "XOR", ["q1", "q0"])],
              flipflops=[{"name": "q0", "d": "n0"}, {"name": "q1", "d": "x1"}])
    i = run(order_f, ctr)
    check("F: correct 2-bit counter passes (4/4 steps)", i["pass"] and i["correct"]["passed"] == 4, short(i))
    ctr_bad = _bp([], {"q1": "q1", "q0": "q0"}, [_g("n0", "NOT", ["q0"]), _g("x1", "AND", ["q1", "q0"])],
                  flipflops=[{"name": "q0", "d": "n0"}, {"name": "q1", "d": "x1"}])
    i = run(order_f, ctr_bad)
    check("F: wrong counter fails", not i["pass"] and i["failure_category"] == "wrong_logic", i["note"])

    # ---- assembly: 4-bit add/subtract from library full adders
    lib = {"full_adder": {"id": "full_adder", "ports": {"inputs": ["a", "b", "cin"], "outputs": ["sum", "cout"]},
                          "blueprint": _bp(["a", "b", "cin"], {"sum": "sum", "cout": "cout"}, [
                              _g("x1", "XOR", ["a", "b"]), _g("sum", "XOR", ["x1", "cin"]), _g("a1", "AND", ["a", "b"]),
                              _g("a2", "AND", ["x1", "cin"]), _g("cout", "OR", ["a1", "a2"])]),
                          "verified": True, "gates": 5, "born_shift": 1}}
    as_in = ["a3", "a2", "a1", "a0", "b3", "b2", "b1", "b0", "op"]

    def as_truth(v):
        a = v["a3"] * 8 + v["a2"] * 4 + v["a1"] * 2 + v["a0"]
        b = v["b3"] * 8 + v["b2"] * 4 + v["b1"] * 2 + v["b0"]
        r = a + b if v["op"] == 0 else a + (15 - b) + 1
        return {"s3": (r >> 3) & 1, "s2": (r >> 2) & 1, "s1": (r >> 1) & 1, "s0": r & 1, "cout": (r >> 4) & 1}

    order_i = _comb_order("I", as_in, ["s3", "s2", "s1", "s0", "cout"], as_truth)

    def addsub(cin1="c1", fa1_extra=None):
        insts = [{"name": "fa0", "part": "full_adder", "wire": {"a": "a0", "b": "x0", "cin": "op", "sum": "s0", "cout": "c1"}},
                 {"name": "fa1", "part": "full_adder", "wire": {"a": "a1", "b": "x1", "cin": cin1, "sum": "s1", "cout": "c2"}},
                 {"name": "fa2", "part": "full_adder", "wire": {"a": "a2", "b": "x2", "cin": "c2", "sum": "s2", "cout": "c3"}},
                 {"name": "fa3", "part": "full_adder", "wire": {"a": "a3", "b": "x3", "cin": "c3", "sum": "s3", "cout": "c4"}}]
        return _bp(as_in, {"s3": "s3", "s2": "s2", "s1": "s1", "s0": "s0", "cout": "c4"},
                   [_g(f"x{k}", "XOR", [f"b{k}", "op"]) for k in range(4)], insts)

    i = run(order_i, addsub(), lib)
    check("I: 4-bit add/sub assembly passes 512/512", i["correct"] == {"ok": True, "passed": 512, "total": 512} and i["gates"] == 24, short(i) + f"; fanout rule: {i['rules']['fanout']} (op feeds 6 pins: needs a buffer)")
    i = run(order_i, addsub("b3"), lib)
    check("I: carry mis-wire (fa1.cin <- b3) -> assembly, bad_wires=[[b3, fa1.cin]]",
          i["failure_category"] == "assembly" and i["bad_wires"] == [["b3", "fa1.cin"]] and i["bad_blocks"] == ["fa1"] and not i["correct"]["ok"],
          f"{i['correct']['passed']}/{i['correct']['total']}; {i['note']}")
    check("I: mis-wire note names the right driver", "carry wire into fa1 comes from b3 (should be fa0.cout)" in i["note"], i["note"])
    bp_bad = _norm(addsub("b3"))
    hit = _chain_heuristic(bp_bad, lib)
    check("I: structural fallback heuristic blames the same port", hit == ("fa1", "cin", "b3", "c1"), str(hit))
    bw = addsub()
    bw["instances"][2]["wire"].pop("cin")
    i = run(order_i, bw, lib)
    check("I: unwired port -> format", i["failure_category"] == "format" and "not wired" in i["note"] and i["bad_blocks"] == ["fa2"], i["note"])
    bu = addsub()
    bu["instances"][1]["part"] = "full_adder9"
    i = run(order_i, bu, lib)
    check("I: unknown part -> format", i["failure_category"] == "format" and "unknown part" in i["note"], i["note"])
    bn = addsub("ghost")
    i = run(order_i, bn, lib)
    check("I: wire to a non-existent signal -> assembly", i["failure_category"] == "assembly" and i["bad_wires"] == [["ghost", "fa1.cin"]], i["note"])
    bo = addsub()
    bo["outputs"]["cout"] = "c9"
    try:
        flatten(bo, lib)
        check("flatten: output mapped to non-existent signal raises FormatError", False)
    except FormatError as e:
        check("flatten: output mapped to non-existent signal raises FormatError", "does not exist" in str(e), str(e))

    # ---- fan-out
    fo_in = ["a", "b"]
    order_fo = _comb_order("FO", fo_in, ["y1", "y2", "y3", "y4", "y5"],
                           lambda v: {"y1": v["a"] & v["b"], "y2": v["a"] | v["b"], "y3": v["a"] ^ v["b"], "y4": 1 - (v["a"] & v["b"]), "y5": v["a"] & (v["a"] ^ v["b"])},
                           allowed=("AND", "OR", "XOR", "NAND", "NOT"))
    fo5 = _bp(fo_in, {f"y{k}": f"y{k}" for k in range(1, 6)}, [
        _g("y1", "AND", ["a", "b"]), _g("y2", "OR", ["a", "b"]), _g("y3", "XOR", ["a", "b"]), _g("y4", "NAND", ["a", "b"]), _g("y5", "AND", ["a", "y3"])])
    i = run(order_fo, fo5)
    check("fan-out 5 on one signal -> rules.fanout = fail", i["correct"]["ok"] and i["rules"]["fanout"] == "fail" and i["failure_category"] == "rules" and not i["pass"], i["note"])
    fo4 = copy.deepcopy(fo5)
    fo4["gates"][4] = _g("y5", "NOT", ["y3"])
    i = run(_comb_order("FO4", fo_in, ["y1", "y2", "y3", "y4", "y5"],
                        lambda v: {"y1": v["a"] & v["b"], "y2": v["a"] | v["b"], "y3": v["a"] ^ v["b"], "y4": 1 - (v["a"] & v["b"]), "y5": 1 - (v["a"] ^ v["b"])},
                        allowed=("AND", "OR", "XOR", "NAND", "NOT")), fo4)
    check("fan-out 4 is fine", i["pass"] and i["rules"]["fanout"] == "ok", short(i))

    # ---- misc: unused / depth / metrics / tidy / simulate / format
    un = copy.deepcopy(d8)
    un["gates"].append(_g("dead", "AND", ["a", "b"]))
    i = run(order_d, un)
    check("unused gate -> rules.unused = fail", i["rules"]["unused"] == "fail" and i["failure_category"] == "rules" and "dead" in i["note"], i["note"])
    chain = _bp(["a", "b"], {"y": "g14"}, [_g("g1", "AND", ["a", "b"])] + [_g(f"g{k}", "NOT", [f"g{k - 1}"]) for k in range(2, 15)])
    i = run(_comb_order("CH", ["a", "b"], ["y"], lambda v: {"y": (v["a"] & v["b"]) ^ 1}), chain)
    check("depth 14 > 12 -> rules.depth = fail", i["rules"]["depth"] == "fail" and i["depth"] == 14, i["note"])
    m = {"model": "x", "tokens_in": 5}
    i = inspect(order_d, d8, {}, "v7", 3, m)
    m["tokens_in"] = 999
    check("metrics copied into the Inspection", i["metrics"] == {"model": "x", "tokens_in": 5} and i["version"] == "v7" and i["attempt"] == 3 and i["order_id"] == "D")
    messy = _bp(["a", "b"], {"y": "n2"}, [
        _g("g1", "AND", ["a", "b"]), _g("g2", "AND", ["b", "a"]), _g("n1", "NOT", ["g1"]), _g("n2", "NOT", ["n1"]), _g("z", "XOR", ["a", "b"])])
    t = tidy(_norm(messy))
    ok_t = len(t["gates"]) == 1 and t["outputs"] == {"y": "g1"}
    check("tidy: dedupes AND, removes double NOT, drops dead XOR", ok_t, str([g["name"] for g in t["gates"]]))
    check("tidy keeps the logic identical", _check(_comb_order("T", ["a", "b"], ["y"], lambda v: {"y": v["a"] & v["b"]}), t)["ok"])
    s = simulate(flatten(addsub(), lib), {"a3": 0, "a2": 1, "a1": 0, "a0": 1, "b3": 0, "b2": 0, "b1": 1, "b0": 1, "op": 0})
    check("simulate: 5 + 3 = 8", (s["s3"], s["s2"], s["s1"], s["s0"], s["c4"]) == (1, 0, 0, 0, 0))
    for label, bad, frag in [
            ("unknown gate type", _bp(d_in, {"y": "g"}, [_g("g", "NOR", ["a", "b"])]), "unknown type"),
            ("wrong arity", _bp(d_in, {"y": "g"}, [_g("g", "AND", ["a"])]), "needs exactly 2"),
            ("duplicate names", _bp(d_in, {"y": "g"}, [_g("g", "AND", ["a", "b"]), _g("g", "OR", ["a", "b"], "h")]), "used twice"),
            ("duplicate drivers", _bp(d_in, {"y": "g"}, [_g("g", "AND", ["a", "b"]), _g("h", "OR", ["a", "b"], "g")]), "driven twice"),
            ("output to missing signal", _bp(d_in, {"y": "nope"}, [_g("g", "AND", ["a", "b"])]), "does not exist"),
            ("undriven gate input", _bp(d_in, {"y": "g"}, [_g("g", "AND", ["a", "zz"])]), "does not exist"),
            ("feedback loop", _bp(d_in, {"y": "g"}, [_g("g", "AND", ["a", "h"]), _g("h", "OR", ["g", "b"])]), "feedback loop"),
            ("unmapped order output", _bp(d_in, {}, [_g("g", "AND", ["a", "b"])]), "not mapped")]:
        i = run(order_d, bad)
        check(f"format: {label}", i["failure_category"] == "format" and frag in i["note"] and i["rules"]["format"] == "fail", i["note"])

    print(f"\n{sum(results)}/{len(results)} checks passed")
    return all(results)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if _selftest() else 1)
    print(__doc__)
