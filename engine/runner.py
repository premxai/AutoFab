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
STATE = {"updated": None, "status": "idle", "current_version": "v1", "versions": [], "shifts": [], "exam": {}, "live": None, "live_runs": {},
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


async def run_batch(orders_, snapshot, library, parallel, learn, shift, tag, sink=None):
    """`sink`: a list inside STATE that receives each stripped ChipRun as it finishes, so the stage fills in live."""
    global _chips_done
    sem = asyncio.Semaphore(parallel)
    results = [None] * len(orders_)

    async def one(i, o):
        global _chips_done
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
            if sink is not None:
                sink.append(_strip(run))
            write_state()

    await asyncio.gather(*[one(i, o) for i, o in enumerate(orders_)])
    return results


# ---------------------------------------------------------------- the factory loop
async def run_shifts(n_shifts, n_practice, n_validation, parallel, exam_versions, seed, resume=False):
    library = Library.load()
    first_shift = 1
    if resume and os.path.exists(RUN_JSON):
        STATE.update(json.load(open(RUN_JSON, encoding="utf-8")))
        STATE["shifts"] = [s for s in STATE["shifts"] if s.get("validation") is not None]      # drop a partial shift
        STATE["exam"] = {v: e for v, e in STATE["exam"].items() if not e.get("in_progress")}
        first_shift = len(STATE["shifts"]) + 1
        snapshot = GATE.load(STATE["current_version"])
        print(f"resuming at shift {first_shift} on {snapshot['version']} (exams done: {list(STATE['exam'])})")
    else:
        snapshot = GATE.make_v1()
    GATE.save(snapshot)
    STATE.update({"status": "running", "current_version": snapshot["version"]})
    if snapshot["version"] not in STATE["versions"]:
        STATE["versions"].append(snapshot["version"])
    exam = exam_orders()
    orders_by_id = {o["id"]: o for o in exam}
    if snapshot["version"] in exam_versions and snapshot["version"] not in STATE["exam"]:   # v1 at start, or a version due after a resume
        await run_exam(snapshot, library, exam, parallel)
    for shift in range(first_shift, n_shifts + 1):
        practice = ORD.make_orders("practice", n_practice, seed + 100 * shift)
        orders_by_id.update({o["id"]: o for o in practice})
        entry = {"shift": shift, "version": snapshot["version"], "practice": [], "validation": None, "lessons_added": [], "categories": {}}
        STATE["shifts"].append(entry); write_state()
        runs = await run_batch(practice, snapshot, library, parallel, True, shift, f"p{shift}", sink=entry["practice"])
        inv = await INV.investigate_shift(runs, orders_by_id, library, shift, snapshot["routing"], snapshot["flags"]["schema_on"], learn=True)
        entry["categories"], entry["lessons_added"] = inv["categories"], inv["lessons_added"]
        library.save()
        old_sum = GATE.summarize(runs)
        proposal = GATE.propose(snapshot, inv["categories"], old_sum["cost_usd"], old_sum["pass"])
        if proposal:
            cand = GATE.apply(snapshot, proposal)
            n_focus = max(1, (n_validation * 6) // 10)
            val = (ORD.make_orders("validation", n_focus, seed + 100 * shift + 50, rungs=GATE.focus_rungs(proposal)) +
                   ORD.make_orders("validation", n_validation - n_focus, seed + 100 * shift + 60))
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
    entry = {"pass_rate": None, "by_rung": {}, "gates_vs_best": None, "cost_per_chip": None, "attempts": None, "categories": {},
             "runs": [], "in_progress": True, "total": len(exam)}
    STATE["exam"][snapshot["version"]] = entry; write_state()
    runs = await run_batch(exam, snapshot, view, parallel, False, 0, f"exam_{snapshot['version']}", sink=entry["runs"])
    s = GATE.summarize(runs)
    entry.update({"pass_rate": round(s["pass"], 3), "by_rung": s["by_rung"], "gates_vs_best": s["gates_vs_best"],
                  "cost_per_chip": s["cost_usd"], "attempts": s["attempts"], "categories": INV.categories(runs), "in_progress": False})
    print(f"EXAM {snapshot['version']}: pass {s['pass']:.2f} by_rung {s['by_rung']} gates/best {s['gates_vs_best']} cost {s['cost_usd']}")
    write_state()


def live_order(req):
    """A judge picks an exam order by id (menu), types a plain-English note, or asks for a fresh unseen order of a rung."""
    if req.get("order_id"):
        for o in exam_orders():
            if o["id"] == req["order_id"]:
                return o
    if req.get("note"):
        return order_from_note(str(req["note"]))
    rung = int(req.get("rung") or 2)
    return ORD.make_orders("validation", 1, int(time.time()) % 100000, rungs=[rung])[0]


_NOTE_KINDS = [  # (keywords in the note, rung to draw from, keywords a generated title should contain)
    (("lock", "door", "open", "code"), 2, ()),
    (("subtract", "minus", "take away"), 1, ("subtract",)),
    (("add", "plus", "sum", "calculator"), 1, ("add",)),
    (("traffic",), 5, ("traffic",)), (("blink",), 5, ("blink",)), (("count",), 5, ("count",)),
    (("bigger", "greater", "larger", "compare"), 6, ("bigger",)),
    (("vote", "majority"), 6, ("majority",)), (("parity", "odd", "even"), 6, ("parity",)),
    (("digit", "display", "segment"), 6, ("display", "segment")),
]


def order_from_note(note):
    """Turn a judge's one-line note into a real order with a truth table. Door locks are built exactly from the codes in the
    note; other kinds pick the closest generated order; anything else falls back to the best-matching exam order."""
    import random, re
    text = note.lower()
    nums = [int(n) for n in re.findall(r"\d+", text)]
    kind = next((k for k in _NOTE_KINDS if any(w in text for w in k[0])), None)
    d = None
    if kind and kind[1] == 2 and nums:
        codes = sorted({n for n in nums if n < 32})
        nin = 4 if max(codes) < 16 else 5
        inputs = ORD._letters(nin)
        title = f"Door lock that opens only for codes {ORD._codes_text(codes)}"
        spec = (f"A door lock with {nin} switches {', '.join(inputs)} (a is the biggest digit of the binary number): "
                f"the light y turns on only when the switches show {ORD._list_text(codes)}, and stays off for every other number.")
        d = ORD._draft(2, title, spec, inputs, ["y"], ORD._table(inputs, ["y"], lambda bits: {"y": ORD._num(bits) in codes}))
    elif kind:
        rng = random.Random(f"note:{text}")
        cands = [ORD.GENERATORS[kind[1]](rng) for _ in range(40)]
        d = next((c for c in cands if all(w in c["title"].lower() for w in kind[2])), cands[0])
    if d is None:                                      # free text: the exam order whose title shares the most words
        words = set(re.findall(r"[a-z]+", text))
        return max(exam_orders(), key=lambda o: len(words & set(re.findall(r"[a-z]+", o["title"].lower()))))
    d.update({"id": f"ord_j{int(time.time()) % 100000}_{random.randrange(1000):03d}", "pool": "validation", "seed": 0,
              "best_known_gates": ORD.yosys_io.best_known_gates(d) if d.get("truth") is not None else None})
    if d["rung"] == 4:
        ORD._finish_constrained(d)
    return {k: d[k] for k in ORD.ORDER_KEYS}


def write_menu():
    """orders/menu.json: titles the stage can offer the judge (exam orders, no answers)."""
    menu = [{"id": o["id"], "rung": o["rung"], "title": o["title"]} for o in exam_orders()]
    os.makedirs(os.path.join(ROOT, "orders"), exist_ok=True)
    json.dump(menu, open(os.path.join(ROOT, "orders", "menu.json"), "w", encoding="utf-8"), indent=1)


LIVE_KEEP = 20          # live runs kept in run.json (the newest)


async def run_live(path, req, library, sem):
    """One judge order, published live: run.json.live_runs[run_id] grows event by event, then holds the finished ChipRun."""
    global _chips_done
    rid = os.path.basename(path)[:-5]
    versions = sorted(glob.glob(os.path.join(GATE.SNAP_DIR, "v*.json")), key=lambda p: int(os.path.basename(p)[1:-5]))
    snap = GATE.load(req.get("version")) if req.get("version") and os.path.exists(os.path.join(GATE.SNAP_DIR, req["version"] + ".json")) \
        else (GATE.load(os.path.basename(versions[-1])[:-5]) if versions else GATE.make_v1())
    try:
        order = live_order(req)
    except Exception:
        order = ORD.make_orders("validation", 1, int(time.time()) % 100000, rungs=[2])[0]
    lib = library_for(snap, library)
    entry = {"run_id": rid, "version": snap["version"], "status": "running", "order": ORD.agent_view(order), "events": [],
             "attempts": 0, "blueprint": None, "inspection": None, "note": req.get("note")}
    STATE["live_runs"][rid] = entry; STATE["live"] = entry; write_state()
    last = [0.0]
    def on_event(events):
        entry["events"] = list(events)
        if time.time() - last[0] > 0.4:                # throttle the rewrite of run.json
            last[0] = time.time(); write_state()
    async with sem:
        try:
            run = await run_order(order, snap, lib, rid, on_event=on_event)
        except Exception as e:
            run = {"run_id": rid, "version": snap["version"], "order": ORD.agent_view(order), "attempts": 0,
                   "events": entry["events"] + [{"t": 0, "type": "fail", "attempt": 1, "category": "format", "note": f"runner error: {e}", "bad_wires": [], "bad_blocks": []}, {"t": 0, "type": "done"}],
                   "blueprint": None, "yosys_json": None, "inspection": None, "calls": []}
    try:
        if run.get("blueprint"):
            from . import yosys_io, inspector
            run["yosys_json"] = yosys_io.to_yosys_json(inspector.flatten(run["blueprint"], lib.parts))
    except Exception:
        pass
    _calls_seen.extend(run.get("calls", []))
    _chips_done += 1
    save_run(run)
    done = _strip(run) | {"status": "done", "note": req.get("note")}
    STATE["live_runs"][rid] = done; STATE["live"] = done
    for old in sorted(STATE["live_runs"])[:-LIVE_KEEP]:
        del STATE["live_runs"][old]
    write_state()


async def live_loop(parallel):
    """Watch orders/live_*.json (written by server.py POST /order); run each on the requested or latest version, in parallel."""
    seen = set()
    library = Library.load()
    write_menu()
    if os.path.exists(RUN_JSON):                       # keep the long run's shifts/exam on screen while serving live orders
        STATE.update(json.load(open(RUN_JSON, encoding="utf-8")))
    if not isinstance(STATE.get("live_runs"), dict):
        STATE["live_runs"] = {}
    STATE["status"] = "running"
    sem = asyncio.Semaphore(parallel)
    seen.update(os.path.join(ROOT, "orders", f"{rid}.json") for rid in STATE["live_runs"])   # served before a restart
    tasks = set()
    while True:
        for path in sorted(glob.glob(os.path.join(ROOT, "orders", "live_*.json"))):
            if path in seen:
                continue
            seen.add(path)
            try:
                req = json.load(open(path, encoding="utf-8"))
            except ValueError:
                continue
            t = asyncio.create_task(run_live(path, req, library, sem)); tasks.add(t); t.add_done_callback(tasks.discard)
        write_state()                                   # heartbeat: the server treats a fresh run.json as "runner alive"
        await asyncio.sleep(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shifts", type=int, default=8); ap.add_argument("--practice", type=int, default=10); ap.add_argument("--validation", type=int, default=10)
    ap.add_argument("--parallel", type=int, default=8); ap.add_argument("--exam", default="v1,v4,v8"); ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--smoke", action="store_true"); ap.add_argument("--exam-only", default=None); ap.add_argument("--live", action="store_true")
    ap.add_argument("--resume", action="store_true", help="continue from runs/run.json and the latest snapshot")
    a = ap.parse_args()
    if a.live:
        asyncio.run(live_loop(a.parallel)); return
    if a.exam_only:
        snap, lib = GATE.load(a.exam_only), Library.load()
        asyncio.run(run_exam(snap, lib, exam_orders(), a.parallel)); return
    if a.smoke:
        asyncio.run(run_shifts(1, 2, 2, 2, [], a.seed)); return
    asyncio.run(run_shifts(a.shifts, a.practice, a.validation, a.parallel, [v.strip() for v in a.exam.split(",") if v.strip()], a.seed, resume=a.resume))


if __name__ == "__main__":
    main()
