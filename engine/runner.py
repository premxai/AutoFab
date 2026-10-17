"""Shifts, the Gate, the exam, and run.json. The factory is the product.

  python -m engine.runner --smoke                      # 2 practice orders, 1 shift, no exam
  python -m engine.runner --shifts 8 --exam v1,v4,v8   # the long run (start 14:00)
  python -m engine.runner --exam-only v3               # re-run the frozen exam on one version
  python -m engine.runner --live                       # watch orders/live_*.json and run them on the latest version
"""
import argparse, asyncio, glob, json, os, time
from . import orders as ORD, gate as GATE, investigator as INV
from .agents import run_order
from .library import Library

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(ROOT, "runs")
RUN_JSON = os.path.join(RUNS, "run.json")
EXAM_SEED = 4242
STATE = {"updated": None, "status": "idle", "current_version": "v1", "versions": [], "shifts": [], "exam": {}, "live": None,
         "gauges": {"tok_s": 0, "ttft_s": None, "cache_rate": 0.0, "cost_total_usd": 0.0, "chips_per_hour": 0, "human_pings": 0}}
_calls_seen = []
_started = time.time()
_chips_done = 0


# ---------------------------------------------------------------- run.json
def _strip(run):
    r = dict(run)
    r["calls"] = [{k: v for k, v in c.items() if k not in ("content", "reasoning")} for c in run.get("calls", [])]
    return r


def write_state():
    global _chips_done
    calls = _calls_seen
    tok_out = sum(c.get("tokens_out", 0) for c in calls); secs = sum(c.get("time_s", 0) for c in calls) or 1
    cached = [(c.get("cached_tokens") or 0, c.get("tokens_in", 0)) for c in calls if c.get("cached_tokens") is not None]
    STATE["gauges"] = {"tok_s": round(tok_out / secs), "ttft_s": next((c.get("ttft_s") for c in reversed(calls) if c.get("ttft_s")), None),
                       "cache_rate": round(sum(a for a, _ in cached) / max(1, sum(b for _, b in cached)), 3) if cached else 0.0,
                       "cost_total_usd": round(sum(c.get("cost_usd", 0) for c in calls), 4),
                       "chips_per_hour": round(_chips_done / max(1e-6, (time.time() - _started) / 3600)),
                       "human_pings": sum(1 for s in STATE["shifts"] for r in s["practice"] for e in r["events"] if e["type"] == "human_ping")}
    STATE["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    os.makedirs(RUNS, exist_ok=True)
    tmp = RUN_JSON + ".tmp"
    json.dump(STATE, open(tmp, "w", encoding="utf-8"))
    os.replace(tmp, RUN_JSON)


def save_run(run):
    json.dump(_strip(run), open(os.path.join(RUNS, f"{run['run_id']}.json"), "w", encoding="utf-8"), indent=1)


# ---------------------------------------------------------------- batches
def library_for(snapshot, library):
    """The library exactly as this version knew it (parts and lessons listed in the snapshot)."""
    view = library.snapshot_view()
    if snapshot.get("library") is not None:
        view.parts = {k: v for k, v in view.parts.items() if k in set(snapshot["library"])}
    if snapshot.get("playbook") is not None:
        ids = set(snapshot["playbook"])
        view.lessons = [l for l in view.lessons if l["id"] in ids]
    return view


async def run_batch(orders_, snapshot, library, parallel, learn, shift, tag):
    global _chips_done
    sem = asyncio.Semaphore(parallel)
    results = [None] * len(orders_)

    async def one(i, o):
        async with sem:
            rid = f"{tag}_{snapshot['version']}_{o['id']}"
            try:
                run = await run_order(o, snapshot, library, rid, learn=learn, shift=shift)
            except Exception as e:                       # never let one chip kill the shift
                run = {"run_id": rid, "version": snapshot["version"], "order": ORD.agent_view(o), "attempts": 0,
                       "events": [{"t": 0, "type": "order"}, {"t": 0, "type": "fail", "attempt": 1, "category": "format", "note": f"runner error: {e}", "bad_wires": [], "bad_blocks": []}, {"t": 0, "type": "done"}],
                       "blueprint": None, "yosys_json": None, "inspection": None, "calls": []}
            try:
                if run.get("blueprint"):
                    from . import yosys_io, inspector
                    run["yosys_json"] = yosys_io.to_yosys_json(inspector.flatten(run["blueprint"], library.parts))
            except Exception:
                pass
            _calls_seen.extend(run.get("calls", []))
            _chips_done += 1
            results[i] = run
            save_run(run)
            write_state()

    await asyncio.gather(*[one(i, o) for i, o in enumerate(orders_)])
    return results


# ---------------------------------------------------------------- the factory loop
async def run_shifts(n_shifts, n_practice, n_validation, parallel, exam_versions, seed):
    library = Library.load()
    snapshot = GATE.load("v1") if os.path.exists(os.path.join(GATE.SNAP_DIR, "v1.json")) else GATE.make_v1()
    GATE.save(snapshot)
    STATE.update({"status": "running", "current_version": snapshot["version"], "versions": [snapshot["version"]]})
    exam = exam_orders()
    orders_by_id = {o["id"]: o for o in exam}
    if "v1" in exam_versions and "v1" not in STATE["exam"]:
        await run_exam(snapshot, library, exam, parallel)
    for shift in range(1, n_shifts + 1):
        practice = ORD.make_orders("practice", n_practice, seed + 100 * shift)
        orders_by_id.update({o["id"]: o for o in practice})
        entry = {"shift": shift, "version": snapshot["version"], "practice": [], "validation": None, "lessons_added": [], "categories": {}}
        STATE["shifts"].append(entry); write_state()
        runs = await run_batch(practice, snapshot, library, parallel, True, shift, f"p{shift}")
        entry["practice"] = [_strip(r) for r in runs]
        inv = await INV.investigate_shift(runs, orders_by_id, library, shift, snapshot["routing"], snapshot["flags"]["schema_on"], learn=True)
        entry["categories"], entry["lessons_added"] = inv["categories"], inv["lessons_added"]
        library.save()
        old_sum = GATE.summarize(runs)
        proposal = GATE.propose(snapshot, inv["categories"], old_sum["cost_usd"], old_sum["pass"])
        if proposal:
            cand = GATE.apply(snapshot, proposal)
            val = ORD.make_orders("validation", n_validation, seed + 100 * shift + 50)
            orders_by_id.update({o["id"]: o for o in val})
            old_runs = await run_batch(val, snapshot, library_for(snapshot, library), parallel, False, shift, f"vo{shift}")
            cand["playbook"] = [l["id"] for l in library.active_lessons()]; cand["library"] = sorted(library.parts)
            new_runs = await run_batch(val, cand, library_for(cand, library), parallel, False, shift, f"vn{shift}")
            o, n = GATE.summarize(old_runs), GATE.summarize(new_runs)
            verdict, reason = GATE.decide(o, n)
            entry["validation"] = {"proposal": proposal["proposal"], "hypothesis": proposal["hypothesis"], "old": [_strip(r) for r in old_runs],
                                   "new": [_strip(r) for r in new_runs], "verdict": verdict, "reason": reason,
                                   "delta": {"pass": round(n["pass"] - o["pass"], 3), "cost_usd": round(n["cost_usd"] - o["cost_usd"], 4)}}
            snapshot = GATE.commit(snapshot, proposal, verdict, reason, o, n, shift, library.parts.keys(), [l["id"] for l in library.active_lessons()], cand)
        else:
            snapshot = GATE.commit(snapshot, {"proposal": "none", "hypothesis": "nothing to change"}, "keep", "no proposal", old_sum, old_sum, shift,
                                   library.parts.keys(), [l["id"] for l in library.active_lessons()], snapshot)
        GATE.save(snapshot)
        STATE["current_version"] = snapshot["version"]; STATE["versions"].append(snapshot["version"])
        print(GATE.shift_log_line(snapshot["change_log"][-1]))
        write_state()
        if snapshot["version"] in exam_versions:
            await run_exam(snapshot, library, exam, parallel)
    STATE["status"] = "done"; write_state()


def exam_orders():
    path = os.path.join(ROOT, "orders", "exam.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    ex = ORD.exam_orders(EXAM_SEED)
    json.dump(ex, open(path, "w", encoding="utf-8"))
    return ex


async def run_exam(snapshot, library, exam, parallel):
    view = library_for(snapshot, library)
    runs = await run_batch(exam, snapshot, view, parallel, False, 0, f"exam_{snapshot['version']}")
    s = GATE.summarize(runs)
    STATE["exam"][snapshot["version"]] = {"pass_rate": round(s["pass"], 3), "by_rung": s["by_rung"], "gates_vs_best": s["gates_vs_best"],
                                          "cost_per_chip": s["cost_usd"], "attempts": s["attempts"],
                                          "categories": INV.categories(runs), "runs": [_strip(r) for r in runs]}
    print(f"EXAM {snapshot['version']}: pass {s['pass']:.2f} by_rung {s['by_rung']} gates/best {s['gates_vs_best']} cost {s['cost_usd']}")
    write_state()


async def live_loop(parallel):
    """Watch orders/live_*.json (written by server.py POST /order); run each on the requested or latest version."""
    seen = set()
    library = Library.load()
    STATE["status"] = "running"
    while True:
        for path in sorted(glob.glob(os.path.join(ROOT, "orders", "live_*.json"))):
            if path in seen:
                continue
            seen.add(path)
            req = json.load(open(path, encoding="utf-8"))
            versions = sorted(glob.glob(os.path.join(GATE.SNAP_DIR, "v*.json")), key=lambda p: int(os.path.basename(p)[1:-5]))
            snap = GATE.load(req.get("version")) if req.get("version") and os.path.exists(os.path.join(GATE.SNAP_DIR, req["version"] + ".json")) \
                else (GATE.load(os.path.basename(versions[-1])[:-5]) if versions else GATE.make_v1())
            order = ORD.order_from_request(req) if hasattr(ORD, "order_from_request") else ORD.make_orders("practice", 1, int(time.time()))[0]
            STATE["live"] = {"run_id": os.path.basename(path)[:-5], "version": snap["version"], "status": "running"}; write_state()
            run = (await run_batch([order], snap, library_for(snap, library), 1, False, 0, "live"))[0]
            STATE["live"] = _strip(run); write_state()
        await asyncio.sleep(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shifts", type=int, default=8); ap.add_argument("--practice", type=int, default=10); ap.add_argument("--validation", type=int, default=10)
    ap.add_argument("--parallel", type=int, default=8); ap.add_argument("--exam", default="v1,v4,v8"); ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--smoke", action="store_true"); ap.add_argument("--exam-only", default=None); ap.add_argument("--live", action="store_true")
    a = ap.parse_args()
    if a.live:
        asyncio.run(live_loop(a.parallel)); return
    if a.exam_only:
        snap, lib = GATE.load(a.exam_only), Library.load()
        asyncio.run(run_exam(snap, lib, exam_orders(), a.parallel)); return
    if a.smoke:
        asyncio.run(run_shifts(1, 2, 2, 2, [], a.seed)); return
    asyncio.run(run_shifts(a.shifts, a.practice, a.validation, a.parallel, [v.strip() for v in a.exam.split(",") if v.strip()], a.seed))


if __name__ == "__main__":
    main()
