"""The Gate: one proposed factory change per shift, chosen from a fixed MENU by the dominant failure category,
validated on a fresh batch against the current version, kept only if it measurably helps (gain beats noise AND
cost is justified AND no rung regresses), else rolled back. Snapshots = versions (docs/CONTRACTS.md §6)."""
import copy, json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_DIR = os.path.join(ROOT, "snapshots")
LIGHTNING = "nvidia/Nemotron-3.5-Lightning-30B-A3B"
SUPER = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B"


def make_v1():
    """The honest bare team: Lightning everywhere, thinking on, no schema, no lessons, no library, no tools."""
    r = lambda model, mt: {"model": model, "thinking": True, "max_tokens": mt}
    return {"version": "v1", "parent": None, "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "routing": {"architect": r(LIGHTNING, 12000), "designer": r(LIGHTNING, 12000), "designer_novel": r(LIGHTNING, 12000),
                        "assembler": r(LIGHTNING, 12000), "investigator": r(LIGHTNING, 6000), "gate": r(SUPER, 8000)},
            "flags": {"schema_on": False, "no_fast_lane": False, "route_novel_to_super": False, "loop_cutter": False,
                      "tidy_tool": False, "fanout_buffer_rule": False, "library_first": False, "stable_prefix": False},
            "playbook": None, "library": [], "change_log": []}


# ---------------------------------------------------------------- the MENU (name, what it fixes, how it changes the snapshot)
def _set_flag(name):
    def f(s): s["flags"][name] = True
    return f

def _route_novel(s):
    s["flags"]["route_novel_to_super"] = True
    s["routing"]["designer_novel"] = {"model": SUPER, "thinking": True, "max_tokens": 20000}
    s["routing"]["architect"] = {"model": SUPER, "thinking": True, "max_tokens": 20000}

def _loop_cutter(s):
    s["flags"]["loop_cutter"] = True
    for role in ("designer", "assembler"):
        s["routing"][role]["max_tokens"] = min(s["routing"][role]["max_tokens"], 10000)

def _super_everywhere(s):
    for role in ("architect", "designer", "designer_novel", "assembler"):
        s["routing"][role] = {"model": SUPER, "thinking": True, "max_tokens": 20000}

def _fast_lane_easy(s):
    s["routing"]["designer"] = {**s["routing"]["designer"], "thinking": False, "max_tokens": 2000}

MENU = [  # (name, fixes categories, applies) — order within a category = order of preference
    ("schema_on", ("format", "spiral"), _set_flag("schema_on")),          # measured: spirals are mostly format anxiety; the schema ends them
    ("route_novel_to_super", ("spiral",), _route_novel),
    ("loop_cutter", ("spiral",), _loop_cutter),
    ("library_first", ("assembly",), _set_flag("library_first")),
    ("fanout_buffer_rule", ("rules",), _set_flag("fanout_buffer_rule")),
    ("tidy_tool", ("budget",), _set_flag("tidy_tool")),
    ("stable_prefix", ("cost",), _set_flag("stable_prefix")),
    ("no_fast_lane", ("wrong_logic",), _set_flag("no_fast_lane")),
    # experiments the Gate may try when nothing dominates; validation decides (these are expected to be rejected)
    ("super_everywhere", ("wrong_logic",), _super_everywhere),
    ("fast_lane_easy", ("cost",), _fast_lane_easy),
]
MIN_RUNG_SAMPLES = 5
# which rungs a change is meant to help: the validation batch is built to contain them ("test what you changed")
FOCUS = {"schema_on": [1, 2, 3, 6], "route_novel_to_super": [2, 3], "loop_cutter": [2, 3, 4], "library_first": [1],
         "fanout_buffer_rule": [1, 3], "tidy_tool": [4], "stable_prefix": [1, 2, 6], "no_fast_lane": [2, 6],
         "super_everywhere": [2, 3, 4], "fast_lane_easy": [1, 6]}


def focus_rungs(proposal):
    return FOCUS.get(proposal["proposal"], [1, 2, 3, 4, 5, 6])


def applied(snapshot):
    return {e["proposal"] for e in snapshot["change_log"] if e["verdict"] == "keep"}


def tried(snapshot):
    return {e["proposal"] for e in snapshot["change_log"]}


def recently_tried(snapshot, window=2):
    """Kept changes are never re-proposed; a reverted change becomes eligible again after `window` shifts (the situation may have changed)."""
    log = snapshot["change_log"]
    last = log[-1]["shift"] if log else 0
    return applied(snapshot) | {e["proposal"] for e in log if e["verdict"] != "keep" and last - e["shift"] < window}


def propose(snapshot, categories, cost_per_chip, pass_rate):
    """Deterministic policy: the first eligible MENU item that targets the dominant failure category; then cost; then experiments."""
    done = recently_tried(snapshot)
    ranked = sorted(categories.items(), key=lambda kv: -kv[1])
    for cat, n in ranked:
        if n == 0:
            break
        for name, fixes, _ in MENU:
            if cat in fixes and name not in done:
                why = {"schema_on": "most failures are no-answer spirals or unreadable blueprints; enforce the blueprint schema so no thinking is spent on format",
                       "route_novel_to_super": "the cheap worker never finishes novel functions; route novel parts to Super"}.get(name, f"{cat} is the dominant failure")
                return _p(name, f"{why} ({n} {cat} this shift)")
    if pass_rate >= 0.6 and "stable_prefix" not in done:
        return _p("stable_prefix", f"pass rate {pass_rate:.0%}; cost {cost_per_chip:.3f}$/chip: make the prompt prefix cache-friendly")
    for name in ("fast_lane_easy", "super_everywhere"):
        if name not in done:
            return _p(name, "no dominant failure; testing a routing experiment")
    return None


def _p(name, hypothesis):
    return {"proposal": name, "hypothesis": hypothesis}


def apply(snapshot, proposal):
    """Return a candidate snapshot (not yet a version) with the change applied."""
    cand = copy.deepcopy(snapshot)
    fn = next(f for n, _, f in MENU if n == proposal["proposal"])
    fn(cand)
    return cand


def summarize(chip_runs):
    n = max(1, len(chip_runs))
    passed = [r for r in chip_runs if (r.get("inspection") or {}).get("pass")]
    by_rung, n_rung = {}, {}
    for r in chip_runs:
        rung = str(r["order"]["rung"])
        by_rung.setdefault(rung, [0, 0]); by_rung[rung][1] += 1
        if (r.get("inspection") or {}).get("pass"):
            by_rung[rung][0] += 1
    n_rung = {k: v[1] for k, v in by_rung.items()}
    cost = sum(((r.get("inspection") or {}).get("metrics") or {}).get("cost_usd", 0) for r in chip_runs) / n
    gates_ratio = [r["inspection"]["gates"] / r["inspection"]["best_known_gates"] for r in passed
                   if r.get("inspection") and r["inspection"].get("best_known_gates")]
    return {"pass": len(passed) / n, "cost_usd": round(cost, 4), "n": n,
            "by_rung": {k: round(v[0] / v[1], 2) for k, v in by_rung.items()}, "n_rung": n_rung,
            "gates_vs_best": round(sum(gates_ratio) / len(gates_ratio), 2) if gates_ratio else None,
            "attempts": round(sum(r.get("attempts", 1) for r in chip_runs) / n, 2)}


def decide(old, new):
    """Keep only if: pass gain beats the noise floor (1/n), cost is justified, no rung regresses by > 0.25.
    A pure cost change (same pass rate, >= 25% cheaper, no regression) is also a keep."""
    noise = 1.0 / max(1, min(old["n"], new["n"]))
    dpass = new["pass"] - old["pass"]
    cost_ratio = (new["cost_usd"] / old["cost_usd"]) if old["cost_usd"] else 1.0
    big = lambda s, k: s.get("n_rung", {}).get(k, 0) >= MIN_RUNG_SAMPLES
    regress = any(new["by_rung"].get(k, 0) < v - 0.25 for k, v in old["by_rung"].items() if big(old, k) and big(new, k))
    if regress:
        return "revert", f"rung regression (old {old['by_rung']} -> new {new['by_rung']})"
    if dpass > noise and (cost_ratio <= 1.5 or dpass >= 0.2):
        return "keep", f"pass {old['pass']:.2f}->{new['pass']:.2f}, cost x{cost_ratio:.2f}"
    if abs(dpass) <= noise and cost_ratio <= 0.75:
        return "keep", f"same pass rate, cost x{cost_ratio:.2f}"
    return "revert", f"pass {old['pass']:.2f}->{new['pass']:.2f} (noise {noise:.2f}), cost x{cost_ratio:.2f}"


def commit(snapshot, proposal, verdict, reason, old, new, shift, library_ids, playbook_ids, candidate=None):
    """Produce the next version: the candidate if kept, else the parent with the rejection logged."""
    base = copy.deepcopy(candidate if verdict == "keep" else snapshot)
    base["parent"] = snapshot["version"]
    base["version"] = f"v{int(snapshot['version'][1:]) + 1}"
    base["created"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    base["library"] = sorted(library_ids)
    base["playbook"] = sorted(playbook_ids)
    base["change_log"] = snapshot["change_log"] + [{"shift": shift, "proposal": proposal["proposal"], "hypothesis": proposal["hypothesis"],
                                                   "verdict": verdict, "reason": reason, "before": old, "after": new}]
    return base


def save(snapshot):
    os.makedirs(SNAP_DIR, exist_ok=True)
    json.dump(snapshot, open(os.path.join(SNAP_DIR, f"{snapshot['version']}.json"), "w", encoding="utf-8"), indent=1)


def load(version):
    return json.load(open(os.path.join(SNAP_DIR, f"{version}.json"), encoding="utf-8"))


def shift_log_line(entry):
    return f"{entry['verdict']}: {entry['proposal']} pass={entry['after']['pass']:.2f} cost={entry['after']['cost_usd']:.3f} ({entry['reason']})"
