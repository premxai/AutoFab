# Task 3 — API + vendoring (`server.py`) · Owner B · branch `web/api`

## What
A tiny FastAPI server that serves the stage and the run data, accepts a live order, and vendors netlistsvg.

## Files you own
`server.py`, `web/netlistsvg.bundle.js`, `web/elk.bundled.js`, `requirements.txt` (add fastapi, uvicorn), `scripts/test.sh` (add a curl check). Read-only: `docs/CONTRACTS.md` §8–§10.

## Spec
- `GET /` → `web/index.html`; `GET /web/*` static.
- `GET /run.json` → `runs/run.json` (404 → `samples/run.sample.json`).
- `GET /runs/{run_id}.json` → `runs/{run_id}.json`. `GET /snapshots/{version}.json`.
- `POST /order` body `{"title","spec","version"}` → writes `orders/live_{ts}.json`, returns `202 {"run_id": "live_{ts}"}` (the runner watches that folder). If `runs/live_fallback.json` exists and the runner is not running, serve it as `live`.
- `GET /schematic/{run_id}.svg` optional: if `runs/{run_id}.json` has `yosys_json`, return it as-is JSON at `/runs/{run_id}.yosys.json`; the page renders with netlistsvg in the browser (`await netlistsvg.render(netlistsvg.digitalSkin, json)`).
- Vendoring: `npm install netlistsvg` in a temp folder, copy `node_modules/netlistsvg/built/netlistsvg.bundle.js` and `node_modules/elkjs/lib/elk.bundled.js` into `web/`. Do not commit `node_modules`.
- CORS open for localhost. Run: `uvicorn server:app --port 8000`.

## Acceptance
`uvicorn server:app --port 8000` → `curl localhost:8000/run.json` returns the sample; `curl -X POST localhost:8000/order -d '{"title":"t","spec":"s","version":"v1"}' -H 'content-type: application/json'` returns 202 and creates `orders/live_*.json`; `/` serves the stage.

## Paste this into Codex on laptop B
```
Read docs/CONTRACTS.md §8–§10 and tasks/api.md. Create server.py (FastAPI + uvicorn) exactly to tasks/api.md, add fastapi and uvicorn to requirements.txt, vendor netlistsvg.bundle.js and elk.bundled.js into web/ (npm install netlistsvg in a temp dir; never commit node_modules), and extend scripts/test.sh with a curl check of /run.json. Work only in server.py, web/*.js vendored files, requirements.txt, scripts/test.sh. Branch web/api. Verify the acceptance commands before you report.
```
