"""After each shift: count failure categories, detect thinking loops, write lessons in the fault's own words,
and feed the Gate the category counts. Lessons follow docs/CONTRACTS.md §5 (when / pitfall / verification)."""
import asyncio, json, re
from collections import Counter
from .client import call

CATEGORIES = ["format", "wrong_logic", "assembly", "rules", "budget", "spiral"]
LESSON_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["when", "pitfall", "verification"],
                 "properties": {"when": {"type": "string"}, "pitfall": {"type": "string"}, "verification": {"type": "string"}}}
MAX_LESSONS_PER_SHIFT = 5


def detect_loop(reasoning: str, n=12, min_repeats=6, window=4000):
    """True if any n-token n-gram repeats >= min_repeats times in the last `window` chars (the Prompt-D 'm14 and m?' pattern)."""
    toks = re.findall(r"\S+", reasoning[-window:])
    if len(toks) < n * min_repeats:
        return False, None
    seen = Counter(" ".join(toks[i:i + n]) for i in range(len(toks) - n + 1))
    gram, count = seen.most_common(1)[0]
    return count >= min_repeats, (gram, count)


def categories(chip_runs):
    c = Counter()
    for r in chip_runs:
        ins = r.get("inspection") or {}
        if not ins.get("pass"):
            c[ins.get("failure_category", "wrong_logic")] += 1
    return {k: c.get(k, 0) for k in CATEGORIES}


def _template_lesson(order, ins):
    cat = ins["failure_category"]
    when = {"format": "handing in a blueprint", "assembly": "wiring parts together", "wrong_logic": f"designing a {order['title'].lower()}",
            "rules": "checking fab rules before handing in", "budget": "designing under a gate budget", "spiral": "designing an unfamiliar function"}[cat]
    pitfall = ins.get("note") or f"{cat} failure"
    verification = {"format": "check that every gate has a name, a valid type, 1 or 2 inputs and an output, and every output maps to a real signal",
                    "assembly": "check every instance port against the previous part's output list before handing in",
                    "wrong_logic": "walk the first failing input vector through the gates by hand before handing in",
                    "rules": "count fan-out per signal and depth before handing in",
                    "budget": "count gates against the budget; share sub-expressions; remove double NOTs",
                    "spiral": "if no answer forms within a few hundred lines of reasoning, stop and hand the part to the stronger model"}[cat]
    return {"when": when, "pitfall": pitfall, "verification": verification}


async def write_lesson(order, ins, routing, schema_on=True):
    """Ask the investigator model to phrase the lesson; fall back to the template."""
    r = routing.get("investigator", routing["designer"])
    msgs = [{"role": "system", "content": "You are the investigator in a chip fab. You write short lessons that carry the fault that taught them."},
            {"role": "user", "content": f"Order: {order['title']}\nFailure category: {ins['failure_category']}\nInspector note: {ins.get('note')}\n"
             f"Correct inputs: {ins['correct']['passed']}/{ins['correct']['total']}. Rules: {json.dumps(ins['rules'])}.\n"
             "Write one lesson: `when` (the situation, a few words), `pitfall` (what went wrong, keep the inspector's words), "
             "`verification` (the check the designer runs before handing in). One sentence each. No generic advice."}]
    try:
        res = await call("investigator", msgs, routing, schema=LESSON_SCHEMA if schema_on else None, thinking=r.get("thinking", True),
                         max_tokens=r.get("max_tokens", 6000), timeout_s=60)
        if res.parsed and all(k in res.parsed for k in ("when", "pitfall", "verification")):
            return res.parsed, res
    except Exception:
        pass
    return _template_lesson(order, ins), None


def _similar(a: str, b: str):
    wa, wb = set(re.findall(r"\w+", a.lower())), set(re.findall(r"\w+", b.lower()))
    return len(wa & wb) / max(1, len(wa | wb)) > 0.6


async def investigate_shift(chip_runs, orders_by_id, library, shift, routing, schema_on=True, learn=True):
    """Returns {"categories": {...}, "lessons_added": [...], "loops": [...]} and (when learn) writes lessons to the library."""
    cats = categories(chip_runs)
    loops, added = [], []
    for r in chip_runs:                       # a runner-level error leaves no inspection; treat it as a format failure with the error as the note
        if r.get("inspection") is None:
            note = next((e.get("note", "") for e in r.get("events", []) if e.get("type") == "fail"), "runner error")
            r["inspection"] = {"pass": False, "failure_category": "format", "note": note, "correct": {"ok": False, "passed": 0, "total": 0},
                               "rules": {}, "gates": 0, "metrics": {}}
    failed = [r for r in chip_runs if not r["inspection"].get("pass")]
    for r in chip_runs:
        for c in r.get("calls", []):
            looped, info = detect_loop(c.get("reasoning", "") or "")
            if looped:
                loops.append({"run_id": r["run_id"], "model": c.get("model"), "gram": info[0][:60], "count": info[1]})
    if not learn:
        return {"categories": cats, "lessons_added": [], "loops": loops}
    # one lesson per failed run, worst categories first, capped; de-duplicated against the library
    failed.sort(key=lambda r: CATEGORIES.index(r["inspection"].get("failure_category", "wrong_logic")))
    tasks = [write_lesson(orders_by_id[r["order"]["id"]], r["inspection"], routing, schema_on) for r in failed[:MAX_LESSONS_PER_SHIFT]]
    results = await asyncio.gather(*tasks) if tasks else []
    for r, (lesson, _) in zip(failed[:MAX_LESSONS_PER_SHIFT], results):
        cat = r["inspection"].get("failure_category", "wrong_logic")
        dup = next((l for l in library.active_lessons() if l["category"] == cat and _similar(l["pitfall"], lesson["pitfall"])), None)
        if dup:
            dup["hits"] += 1
            continue
        added.append(library.add_lesson(lesson["when"], lesson["pitfall"], lesson["verification"], cat, shift))
    # passing retries count as a hit for the lessons of that category (they were read before the retry)
    for r in chip_runs:
        ins = r.get("inspection") or {}
        if ins.get("pass") and r.get("attempts", 1) > 1:
            for l in library.active_lessons():
                if l["category"] == next((e.get("category") for e in r["events"] if e["type"] == "fail"), None):
                    l["hits"] += 1
    return {"categories": cats, "lessons_added": added, "loops": loops}
