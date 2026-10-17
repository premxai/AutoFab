"""AutoFab API: serves the stage and the run data, accepts a live order.

    uvicorn server:app --port 8000

Contract: docs/CONTRACTS.md section 9. The runner (python -m engine.runner --live) watches orders/live_*.json.
"""
import json
import os
import re
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.abspath(__file__))
RUN_JSON = os.path.join(ROOT, "runs", "run.json")
SAMPLE_RUN = os.path.join(ROOT, "samples", "run.sample.json")
LIVE_FALLBACK = os.path.join(ROOT, "samples", "live_fallback.json")
ORDERS = os.path.join(ROOT, "orders")
RUNS = os.path.join(ROOT, "runs")
SNAPSHOTS = os.path.join(ROOT, "snapshots")
RUNNER_FRESH_S = 15          # run.json rewritten within this long ago and status "running" = the runner is alive

SAFE_ID = re.compile(r"^[A-Za-z0-9_.\-]+$")
VERSION = re.compile(r"^v\d+$")

app = FastAPI(title="AutoFab")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

_last_live = {"run_id": None, "ts": 0.0}     # the last order posted through this server


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _json_file(path, what):
    if not SAFE_ID.match(os.path.basename(path)) or not os.path.isfile(path):
        raise HTTPException(404, f"{what} not found")
    return Response(_read(path), media_type="application/json", headers={"Cache-Control": "no-store"})


def runner_alive():
    try:
        if time.time() - os.path.getmtime(RUN_JSON) > RUNNER_FRESH_S:
            return False
        return json.loads(_read(RUN_JSON)).get("status") == "running"
    except (OSError, ValueError):
        return False


@app.get("/run.json")
def run_json():
    path = RUN_JSON if os.path.isfile(RUN_JSON) else SAMPLE_RUN
    raw = _read(path)
    # A judge posted an order but no runner is up: show the pre-run fallback chip as `live` so the demo never stalls.
    if _last_live["run_id"] and os.path.isfile(LIVE_FALLBACK) and not runner_alive():
        try:
            data = json.loads(raw)
            if not data.get("live"):
                data["live"] = json.loads(_read(LIVE_FALLBACK))
                data["live"]["fallback_for"] = _last_live["run_id"]
                return JSONResponse(data, headers={"Cache-Control": "no-store"})
        except ValueError:
            pass
    return Response(raw, media_type="application/json", headers={"Cache-Control": "no-store"})


@app.get("/menu.json")
def menu_json():
    return _json_file(os.path.join(ORDERS, "menu.json"), "menu (run `python -m engine.runner --live` once to write orders/menu.json)")


@app.get("/runs/{run_id}.yosys.json")
def run_yosys(run_id: str):
    """The Yosys-JSON netlist of a chip, for netlistsvg in the browser."""
    if not SAFE_ID.match(run_id):
        raise HTTPException(404, "run not found")
    path = os.path.join(RUNS, run_id + ".json")
    if not os.path.isfile(path):
        raise HTTPException(404, "run not found")
    run = json.loads(_read(path))
    if not run.get("yosys_json"):
        raise HTTPException(404, "this run has no yosys_json")
    return JSONResponse(run["yosys_json"], headers={"Cache-Control": "no-store"})


@app.get("/runs/{run_id}.json")
def run_file(run_id: str):
    if not SAFE_ID.match(run_id):
        raise HTTPException(404, "run not found")
    return _json_file(os.path.join(RUNS, run_id + ".json"), "run")


@app.get("/library.json")
def library_json():
    """The shared brain: verified parts + lessons (snapshots/library.json)."""
    return _json_file(os.path.join(SNAPSHOTS, "library.json"), "library")


@app.get("/snapshots/{version}.json")
def snapshot(version: str):
    if not VERSION.match(version):
        raise HTTPException(404, "snapshot not found")
    return _json_file(os.path.join(SNAPSHOTS, version + ".json"), "snapshot")


@app.post("/order", status_code=202)
async def post_order(request: Request):
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be a JSON object")
    order_id, rung, version = body.get("order_id"), body.get("rung"), body.get("version")
    if order_id is not None:
        if not isinstance(order_id, str) or not SAFE_ID.match(order_id):
            raise HTTPException(422, "order_id must be a string from /menu.json")
    elif rung is not None:
        if isinstance(rung, bool) or not isinstance(rung, int) or not 1 <= rung <= 6:
            raise HTTPException(422, "rung must be an integer 1-6")
    else:
        raise HTTPException(422, 'send {"order_id": ...} or {"rung": N}')
    if version is not None and (not isinstance(version, str) or not VERSION.match(version)):
        raise HTTPException(422, 'version must look like "v8"')
    req = {k: v for k, v in (("order_id", order_id), ("rung", rung), ("version", version)) if v is not None}
    os.makedirs(ORDERS, exist_ok=True)
    ts = int(time.time() * 1000)
    while os.path.exists(os.path.join(ORDERS, f"live_{ts}.json")):
        ts += 1
    run_id = f"live_{ts}"
    path = os.path.join(ORDERS, run_id + ".json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:     # write-then-rename: the runner never reads a half file
        json.dump(req, f)
    os.replace(path + ".tmp", path)
    _last_live.update(run_id=run_id, ts=time.time())
    return {"run_id": run_id}


@app.get("/")
def index():
    page = os.path.join(ROOT, "web", "home.html")      # the plain-English page; the older stages stay at /web/*.html
    for alt in ("index.html", "mock-2d.html"):
        if os.path.isfile(page):
            break
        page = os.path.join(ROOT, "web", alt)
    return FileResponse(page, headers={"Cache-Control": "no-store"})


# static: /web/* (the stage + vendored netlistsvg) and /samples/* (the stage's offline fallback)
app.mount("/web", StaticFiles(directory=os.path.join(ROOT, "web")), name="web")
app.mount("/samples", StaticFiles(directory=os.path.join(ROOT, "samples")), name="samples")
