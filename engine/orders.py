"""Order generator (CONTRACTS section 1). Stdlib only (+ yosys_io for baselines).

    make_orders(pool, n, seed, rungs=None) -> list[dict]
    exam_orders(seed)                      -> 40 orders (rung mix 1:8 2:10 3:6 4:8 5:4 6:4)
    agent_view(order)                      -> order without truth / best_known_gates

Deterministic by seed: the same (pool, seed, n, rungs) always gives the same orders.
Self test:  python -m engine.orders --selftest
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:  # package use:  python -m engine.orders
    from . import yosys_io
except ImportError:  # direct use:  python engine/orders.py
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from engine import yosys_io  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
EXAM_SEED_PATH = ROOT / "orders" / "exam_seed.json"

POOLS = ("practice", "validation", "exam")
POOL_LETTER = {"practice": "p", "validation": "v", "exam": "x"}
DEFAULT_GATES = ["AND", "OR", "XOR", "NOT"]
EXAM_MIX = {1: 8, 2: 10, 3: 6, 4: 8, 5: 4, 6: 4}
ORDER_KEYS = ("id", "pool", "rung", "title", "spec", "inputs", "outputs", "allowed_gates", "gate_budget",
              "flipflops_allowed", "truth", "sequence", "best_known_gates", "seed")
UNKNOWN_BUDGET = 20  # only used if Yosys is unavailable for a NAND-only (rung 4) order


# ----------------------------------------------------------------------------- helpers
def _table(inputs: list[str], outputs: list[str], fn) -> dict:
    """Truth table over every input combination. Key = bit string in `inputs` order (first = MSB).
    `fn(bits)` gets the list of input bits (ints) and returns a dict output -> 0/1."""
    n = len(inputs)
    truth = {}
    for v in range(2 ** n):
        key = format(v, f"0{n}b")
        res = fn([int(c) for c in key])
        truth[key] = {o: int(res[o]) for o in outputs}
    return truth


def _num(bits: list[int]) -> int:
    v = 0
    for b in bits:
        v = (v << 1) | b
    return v


def _codes_text(codes: list[int]) -> str:
    return ", ".join(str(c) for c in codes)


def _list_text(codes: list[int]) -> str:
    c = [str(x) for x in codes]
    return "the number " + c[0] if len(c) == 1 else "the numbers " + ", ".join(c[:-1]) + " or " + c[-1]


def _draft(rung: int, title: str, spec: str, inputs: list[str], outputs: list[str], truth=None,
           sequence=None, allowed=None, flipflops=False) -> dict:
    return {"rung": rung, "title": title, "spec": spec, "inputs": inputs, "outputs": outputs,
            "allowed_gates": list(allowed or DEFAULT_GATES), "gate_budget": None,
            "flipflops_allowed": flipflops, "truth": truth, "sequence": sequence}


# ----------------------------------------------------------------------------- rung 1
def _gen_calculator(rng: random.Random) -> dict:
    n = rng.randint(2, 4)
    kind = rng.choice(["add", "sub", "addsub", "addcin"])
    a = [f"a{i}" for i in range(n - 1, -1, -1)]
    b = [f"b{i}" for i in range(n - 1, -1, -1)]
    extra = {"add": [], "sub": [], "addsub": ["op"], "addcin": ["cin"]}[kind]
    inputs = a + b + extra
    outputs = [f"s{i}" for i in range(n - 1, -1, -1)] + ["cout"]
    mask = (1 << n) - 1

    def fn(bits):
        av, bv = _num(bits[:n]), _num(bits[n:2 * n])
        x = bits[2 * n] if extra else 0
        if kind == "add":
            t = av + bv
        elif kind == "sub":
            t = av + (~bv & mask) + 1
        elif kind == "addsub":
            t = av + bv if x == 0 else av + (~bv & mask) + 1
        else:
            t = av + bv + x
        res = {"cout": (t >> n) & 1}
        for i in range(n):
            res[f"s{i}"] = (t >> i) & 1
        return res

    word = f"{n}-bit"
    if kind == "add":
        title = f"Calculator that adds two {word} numbers"
        spec = (f"Adds the {word} number a to the {word} number b; s is the {word} answer and cout "
                f"lights up when the answer is too big to fit in {n} bits.")
    elif kind == "sub":
        title = f"Calculator that subtracts one {word} number from another"
        spec = (f"Works out a minus b for two {word} numbers; s is the {word} answer (it wraps around when "
                f"b is bigger than a) and cout lights up when a is at least as big as b.")
    elif kind == "addsub":
        title = f"Calculator that adds or subtracts two {word} numbers"
        spec = (f"When the switch op is 0 it adds the {word} numbers a and b, when op is 1 it works out a minus b; "
                f"s is the {word} answer and cout is the carry out (for subtraction it lights up when a is at least b).")
    else:
        title = f"Calculator that adds two {word} numbers plus a carry-in"
        spec = (f"Adds the {word} numbers a and b plus the extra single bit cin; s is the {word} answer and "
                f"cout lights up when the answer is too big to fit in {n} bits.")
    return _draft(1, title, spec, inputs, outputs, _table(inputs, outputs, fn))


# ----------------------------------------------------------------------------- rungs 2, 3, 4
def _letters(n: int) -> list[str]:
    return list("abcde")[:n]


def _gen_lock(rng: random.Random, nin: int = 4) -> dict:
    inputs = _letters(nin)
    codes = sorted(rng.sample(range(2 ** nin), rng.randint(3, 6)))
    title = f"Door lock that opens only for codes {_codes_text(codes)}"
    spec = (f"A door lock with {nin} switches {', '.join(inputs)} (a is the biggest digit of the binary number): "
            f"the light y turns on only when the switches show {_list_text(codes)}, "
            f"and stays off for every other number.")
    truth = _table(inputs, ["y"], lambda bits: {"y": _num(bits) in codes})
    return _draft(2, title, spec, inputs, ["y"], truth)


def _gen_two_light(rng: random.Random, nin: int | None = None) -> dict:
    nin = nin or rng.choice([4, 5])
    inputs = _letters(nin)
    lo, hi = (2, 5) if nin == 4 else (3, 7)
    kg, kr = rng.randint(lo, hi), rng.randint(lo, hi)
    pick = rng.sample(range(2 ** nin), kg + kr)
    green, red = sorted(pick[:kg]), sorted(pick[kg:])
    title = f"Lock with a green light for codes {_codes_text(green)} and a red light for codes {_codes_text(red)}"
    spec = (f"A lock with {nin} switches {', '.join(inputs)} (a is the biggest digit of the binary number): "
            f"the green light turns on only for {_list_text(green)}, the red light turns on only for "
            f"{_list_text(red)}, and for every other number both lights stay off.")
    truth = _table(inputs, ["green", "red"],
                   lambda bits: {"green": _num(bits) in green, "red": _num(bits) in red})
    return _draft(3, title, spec, inputs, ["green", "red"], truth)


def _gen_constrained(rng: random.Random) -> dict:
    base = _gen_lock(rng, 4) if rng.random() < 0.5 else _gen_two_light(rng, 4)
    base["rung"] = 4
    base["allowed_gates"] = ["NAND"]
    return base  # budget / title / spec finished once the NAND baseline is known


def _finish_constrained(d: dict) -> None:
    best = d["best_known_gates"]
    budget = best + 2 if best is not None else UNKNOWN_BUDGET
    d["gate_budget"] = budget
    d["title"] = f"{d['title']}, built from only NAND chips, at most {budget}"
    d["spec"] = (f"{d['spec']} Build it using only NAND chips (a NOT is a NAND with both inputs tied together) "
                 f"and at most {budget} chips in total.")


# ----------------------------------------------------------------------------- rung 5
_COLORS = {"green": "g", "yellow": "y", "red": "r"}
_PERMS = [("green", "yellow", "red"), ("green", "red", "yellow"), ("yellow", "red", "green"),
          ("yellow", "green", "red"), ("red", "green", "yellow"), ("red", "yellow", "green")]


def _gen_sequential(rng: random.Random) -> dict:
    variants = [("traffic", p) for p in _PERMS] + [
        ("count", ("Counter that counts 0, 1, 2, 3 and then starts over", 2, [0, 1, 2, 3])),
        ("count", ("Down counter that goes 0, 3, 2, 1 and then starts over", 2, [0, 3, 2, 1])),
        ("count", ("Gray-code counter that goes 00, 01, 11, 10 and then starts over", 2, [0, 1, 3, 2])),
        ("count", ("Counter that counts 0, 1, 2 and then starts over", 2, [0, 1, 2])),
        ("count", ("Blinker that alternates off, on, off, on", 1, [0, 1])),
        ("count", ("3-bit counter that counts 0 to 4 and then starts over", 3, [0, 1, 2, 3, 4])),
        ("count", ("3-bit counter that counts 0 to 5 and then starts over", 3, list(range(6)))),
        ("count", ("3-bit counter that counts 0 to 6 and then starts over", 3, list(range(7)))),
        ("count", ("3-bit counter that counts 0 to 7 and then starts over", 3, list(range(8)))),
    ]
    kind, data = variants[rng.randrange(len(variants))]
    if kind == "traffic":
        order = data
        title = "Traffic light that cycles " + " → ".join(order)
        outputs = ["g", "y", "r"]
        steps = 6
        expected = [{o: int(_COLORS[order[i % 3]] == o) for o in outputs} for i in range(steps)]
        spec = (f"A traffic light that starts on {order[0]} and, every time the clock ticks, moves to {order[1]}, "
                f"then {order[2]}, then back to {order[0]}. Exactly one of the lights g (green), y (yellow), "
                f"r (red) is on at any moment.")
    else:
        title, bits, seqvals = data
        outputs = [f"q{i}" for i in range(bits - 1, -1, -1)]
        steps = max(6, len(seqvals) + 2)
        expected = [{f"q{j}": (seqvals[i % len(seqvals)] >> j) & 1 for j in range(bits - 1, -1, -1)}
                    for i in range(steps)]
        spec = (f"{title[0].lower() + title[1:]}. The output {', '.join(outputs)} shows the count as a binary number "
                f"(q0 is the smallest digit); it starts at 0 and moves on one step every time the clock ticks.")
        spec = spec[0].upper() + spec[1:]
    return _draft(5, title, spec, [], outputs, None, {"steps": steps, "expected": expected}, flipflops=True)


# ----------------------------------------------------------------------------- rung 6
_SEGMENTS = {0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc",
             8: "abcdefg", 9: "abcdfg"}  # digits 10-15 are blank


def _gen_misc(rng: random.Random) -> dict:
    variants = ([("majority", 3), ("majority", 5)] + [("parity", (n, par)) for n in (3, 4, 5, 6)
                for par in ("Even", "Odd")] + [("segment", s) for s in "abcdefg"] + [("display", None)]
                + [("greater", 2), ("greater", 3)])
    kind, data = variants[rng.randrange(len(variants))]
    if kind == "majority":
        n = data
        ins = _letters(n)
        need = n // 2 + 1
        return _draft(6, f"Majority vote of {n} judges",
                      f"{n} judges ({', '.join(ins)}) each vote yes (1) or no (0); the output y is 1 when "
                      f"at least {need} of them vote yes, otherwise 0.",
                      ins, ["y"], _table(ins, ["y"], lambda bits: {"y": sum(bits) >= need}))
    if kind == "parity":
        n, par = data
        ins = [f"b{i}" for i in range(n - 1, -1, -1)]
        want = 0 if par == "Even" else 1
        word = "an even" if par == "Even" else "an odd"
        return _draft(6, f"{par}-parity detector for {n} bits",
                      f"Looks at {n} bits; the output y is 1 when the number of bits that are 1 is {word} number "
                      f"(counting zero as even), otherwise 0.",
                      ins, ["y"], _table(ins, ["y"], lambda bits: {"y": sum(bits) % 2 == want}))
    if kind == "segment":
        s = data
        ins = ["d3", "d2", "d1", "d0"]
        return _draft(6, f"Digit display segment {s} for digits 0 to 9",
                      f"A seven-segment display is shown a digit from 0 to 9 as a 4-bit number d3 d2 d1 d0; the output y "
                      f"is 1 when segment {s} of the display must light up for that digit "
                      f"(the numbers 10 to 15 light nothing).",
                      ins, ["y"], _table(ins, ["y"], lambda bits: {"y": _num(bits) in _SEGMENTS and s in _SEGMENTS[_num(bits)]}))
    if kind == "display":
        ins = ["d3", "d2", "d1", "d0"]
        outs = [f"seg_{c}" for c in "abcdefg"]
        return _draft(6, "Digit display for digits 0 to 9, all seven segments",
                      "A seven-segment display is shown a digit from 0 to 9 as a 4-bit number d3 d2 d1 d0; each "
                      "output seg_a to seg_g is 1 when that segment must light up (the numbers 10 to 15 light nothing).",
                      ins, outs, _table(ins, outs, lambda bits: {f"seg_{c}": _num(bits) in _SEGMENTS and c in _SEGMENTS[_num(bits)]
                                                                 for c in "abcdefg"}))
    n = data
    ins = [f"a{i}" for i in range(n - 1, -1, -1)] + [f"b{i}" for i in range(n - 1, -1, -1)]
    return _draft(6, f"Comparator that says whether a is bigger than b ({n}-bit)",
                  f"Compares two {n}-bit numbers a and b; the output y is 1 only when a is strictly bigger than b.",
                  ins, ["y"], _table(ins, ["y"], lambda bits: {"y": _num(bits[:n]) > _num(bits[n:])}))


GENERATORS = {1: _gen_calculator, 2: _gen_lock, 3: _gen_two_light, 4: _gen_constrained,
              5: _gen_sequential, 6: _gen_misc}


# ----------------------------------------------------------------------------- public API
def _function_key(d: dict):
    if d["truth"] is not None:
        return ("t", tuple(d["inputs"]), tuple(d["outputs"]),
                tuple((k, tuple(v[o] for o in d["outputs"])) for k, v in sorted(d["truth"].items())))
    return ("s", d["title"])


def _default_rung_sequence(n: int, seed: int, pool: str) -> list[int]:
    base = [r for r, c in EXAM_MIX.items() for _ in range(c)]
    random.Random(f"autofab-mix:{pool}:{seed}").shuffle(base)
    return [base[i % len(base)] for i in range(n)]


def _build(pool: str, seed: int, rung_seq: list[int], baseline: bool = True) -> list[dict]:
    if pool not in POOLS:
        raise ValueError(f"pool must be one of {POOLS}, got {pool!r}")
    master = random.Random(f"autofab:{pool}:{seed}")
    used_titles: set[str] = set()
    used_funcs: set = set()
    drafts: list[dict] = []
    for i, rung in enumerate(rung_seq):
        if rung not in GENERATORS:
            raise ValueError(f"rung must be 1-6, got {rung!r}")
        d = None
        for attempt in range(400):
            order_seed = master.randrange(10 ** 9)
            cand = GENERATORS[rung](random.Random(order_seed))
            fk = _function_key(cand)
            if cand["title"] in used_titles or fk in used_funcs:
                continue
            d = cand
            break
        if d is None:  # pool of distinct templates exhausted: keep going with a numbered title
            d = cand
            d["title"] = f"{d['title']} (variant {i + 1})"
        used_titles.add(d["title"])
        used_funcs.add(_function_key(d))
        d.update({"id": f"ord_{POOL_LETTER[pool]}{seed}_{i + 1:03d}", "pool": pool, "seed": order_seed,
                  "best_known_gates": None})
        drafts.append(d)

    if baseline:
        todo = [d for d in drafts if d["truth"] is not None]
        with ThreadPoolExecutor(max_workers=4) as ex:
            for d, n in zip(todo, ex.map(yosys_io.best_known_gates, todo)):
                d["best_known_gates"] = n
    for d in drafts:
        if d["rung"] == 4:
            _finish_constrained(d)
    return [{k: d[k] for k in ORDER_KEYS} for d in drafts]


def make_orders(pool: str, n: int, seed: int, rungs: list[int] | None = None) -> list[dict]:
    """`n` orders for `pool`, deterministic in (pool, n, seed, rungs). `rungs` = the rungs to draw from
    (round-robin); None = the exam rung mix."""
    if rungs:
        seq = [rungs[i % len(rungs)] for i in range(n)]
    else:
        seq = _default_rung_sequence(n, seed, pool)
    return _build(pool, seed, seq)


def exam_orders(seed: int, path: str | os.PathLike | None = None) -> list[dict]:
    """The 40-order exam (rung mix 1:8 2:10 3:6 4:8 5:4 6:4); writes {seed, ids} to orders/exam_seed.json."""
    seq = [r for r, c in EXAM_MIX.items() for _ in range(c)]
    random.Random(f"autofab-exam-order:{seed}").shuffle(seq)
    orders = _build("exam", seed, seq)
    out = Path(path) if path else EXAM_SEED_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"seed": seed, "ids": [o["id"] for o in orders]}, indent=1) + "\n", encoding="utf-8")
    return orders


def agent_view(order: dict) -> dict:
    """What agents may see: the order without `truth` and `best_known_gates`."""
    return {k: v for k, v in order.items() if k not in ("truth", "best_known_gates")}


# ----------------------------------------------------------------------------- self test
def _selftest() -> int:
    fails = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal fails
        print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
        if not ok:
            fails += 1

    t0 = time.time()
    orders = make_orders("practice", 60, 1, [1, 2, 3, 4, 5, 6])  # 10 per rung, one call
    check("60 orders generated (10 per rung, seed 1)",
          len(orders) == 60 and all(sum(o["rung"] == r for o in orders) == 10 for r in range(1, 7)))

    check("deterministic by seed", orders == make_orders("practice", 60, 1, [1, 2, 3, 4, 5, 6]))
    check("different seed gives different orders",
          [o["title"] for o in make_orders("practice", 6, 2, [2])] != [o["title"] for o in orders if o["rung"] == 2][:6])

    # schema + truth coverage
    bad = []
    for o in orders:
        if list(o) != list(ORDER_KEYS) or o["pool"] != "practice" or not o["spec"] or not o["title"]:
            bad.append((o["id"], "keys"))
        if o["truth"] is not None:
            n = len(o["inputs"])
            want = {format(i, f"0{n}b") for i in range(2 ** n)}
            if set(o["truth"]) != want or any(set(v) != set(o["outputs"]) or not all(x in (0, 1) for x in v.values())
                                              for v in o["truth"].values()):
                bad.append((o["id"], "truth"))
            if o["sequence"] is not None or o["flipflops_allowed"]:
                bad.append((o["id"], "comb flags"))
        else:
            sq = o["sequence"]
            if (o["rung"] != 5 or o["flipflops_allowed"] is not True or not sq or len(sq["expected"]) != sq["steps"]
                    or any(set(e) != set(o["outputs"]) for e in sq["expected"])):
                bad.append((o["id"], "sequence"))
    check("every truth table covers all 2^n input combinations; sequential orders well formed", not bad, str(bad[:3]))
    check("titles unique", len({o["title"] for o in orders}) == 60)
    check("ids unique", len({o["id"] for o in orders}) == 60)
    check("specs are one line", all("\n" not in o["spec"] for o in orders))

    # content correctness
    calc_bad = []
    for o in (x for x in orders if x["rung"] == 1):
        n = len([i for i in o["inputs"] if i.startswith("a")])
        t_ = o["title"]
        for key, out in o["truth"].items():
            bits = dict(zip(o["inputs"], map(int, key)))
            a = sum(bits[f"a{i}"] << i for i in range(n))
            b = sum(bits[f"b{i}"] << i for i in range(n))
            sub = ("subtracts one" in t_) or ("adds or subtracts" in t_ and bits["op"] == 1)
            exp = (a - b) % (1 << n) + ((1 << n) if a >= b else 0) if sub else a + b + bits.get("cin", 0)
            got = sum(out[f"s{i}"] << i for i in range(n)) + (out["cout"] << n)
            if got != exp:
                calc_bad.append((o["id"], key))
    check("calculator truth tables match arithmetic", not calc_bad, str(calc_bad[:2]))

    r4 = [o for o in orders if o["rung"] == 4]
    nand_ok = all(o["allowed_gates"] == ["NAND"] and o["best_known_gates"] is not None
                  and o["gate_budget"] == o["best_known_gates"] + 2 and str(o["gate_budget"]) in o["title"]
                  and "NAND" in o["title"] for o in r4)
    check("rung 4: allowed_gates=[NAND], gate_budget = NAND baseline + 2", nand_ok,
          ", ".join(f"{o['best_known_gates']}->{o['gate_budget']}" for o in r4))
    others = [o for o in orders if o["rung"] in (1, 2, 3, 6)]
    check("rungs 1/2/3/6 have a Yosys baseline and no budget",
          all(o["best_known_gates"] is not None and o["gate_budget"] is None for o in others))
    check("rung 5 has no truth/baseline, flipflops allowed",
          all(o["truth"] is None and o["best_known_gates"] is None and o["flipflops_allowed"] for o in orders if o["rung"] == 5))

    # exam
    scratch = ROOT / "orders" / "_selftest_exam_seed.json"
    ex = exam_orders(42, path=scratch)
    mix = {r: sum(o["rung"] == r for o in ex) for r in range(1, 7)}
    check("exam_orders(42): 40 orders with rung mix 1:8 2:10 3:6 4:8 5:4 6:4", len(ex) == 40 and mix == EXAM_MIX, str(mix))
    saved = json.loads(scratch.read_text(encoding="utf-8"))
    check("exam seed file holds only the seed and the ids",
          saved == {"seed": 42, "ids": [o["id"] for o in ex]} and len({o["title"] for o in ex}) == 40)
    check("exam_orders deterministic", [o["id"] for o in exam_orders(42, path=scratch)] == saved["ids"]
          and exam_orders(42, path=scratch) == ex)
    try:
        scratch.unlink()
    except OSError:
        pass
    check("exam_orders default path is orders/exam_seed.json", EXAM_SEED_PATH.name == "exam_seed.json"
          and EXAM_SEED_PATH.parent.name == "orders")

    # agent view
    v = agent_view(ex[0])
    check("agent_view has no truth / best_known_gates",
          "truth" not in v and "best_known_gates" not in v
          and all(k in v for k in ("title", "spec", "inputs", "outputs", "allowed_gates", "gate_budget", "flipflops_allowed"))
          and "truth" in ex[0])

    # yosys
    lock = {"inputs": list("abcd"), "outputs": ["y"], "allowed_gates": list(DEFAULT_GATES),
            "truth": _table(list("abcd"), ["y"], lambda b: {"y": _num(b) in (1, 6, 7)})}
    yosys_io._run_yosys(yosys_io.truth_to_blif(lock), False)  # warm up the WASM module
    t1 = time.time()
    n = yosys_io._run_yosys(yosys_io.truth_to_blif(lock), False)  # uncached
    dt = time.time() - t1
    check("Yosys baseline for a 4-input lock (codes 1, 6, 7) is 5 gates in < 3 s", n == 5 and dt < 3, f"{n} gates, {dt:.2f}s")
    check("best_known_gates() cached call matches", yosys_io.best_known_gates(lock) == 5 and yosys_io.best_known_gates(lock) == 5)
    # contract-section-10 export
    bp = {"inputs": ["a", "b"], "outputs": {"y": "g2"}, "instances": [], "flipflops": [],
          "gates": [{"name": "g1", "type": "AND", "inputs": ["a", "b"], "output": "g1"},
                    {"name": "g2", "type": "NOT", "inputs": ["g1"], "output": "g2"}]}
    yj = yosys_io.to_yosys_json(bp)
    m = next(iter(yj["modules"].values()))
    ok = (m["cells"]["g1"]["type"] == "$_AND_" and m["cells"]["g2"]["type"] == "$_NOT_"
          and m["cells"]["g2"]["connections"]["A"] == m["cells"]["g1"]["connections"]["Y"]
          and m["ports"]["y"]["bits"] == m["cells"]["g2"]["connections"]["Y"]
          and all(isinstance(b, int) for p in m["ports"].values() for b in p["bits"]))
    bp["flipflops"] = [{"name": "q0", "d": "g2"}]
    m2 = next(iter(yosys_io.to_yosys_json(bp)["modules"].values()))
    ok = ok and m2["cells"]["q0"]["type"] == "$_DFF_P_" and set(m2["cells"]["q0"]["connections"]) == {"D", "C", "Q"}
    check("to_yosys_json follows CONTRACTS section 10", ok)

    print(f"{'ALL PASS' if not fails else str(fails) + ' FAILED'} ({time.time() - t0:.1f}s)")
    return 1 if fails else 0


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        return _selftest()
    if "--exam" in argv:  # python -m engine.orders --exam 42   (freezes orders/exam_seed.json)
        seed = int(argv[argv.index("--exam") + 1])
        ex = exam_orders(seed)
        print(f"wrote {EXAM_SEED_PATH} with {len(ex)} ids (seed {seed})")
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
