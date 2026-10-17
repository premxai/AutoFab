# TASKS — the only status board
Owner A = laptop A (Prem + Claude Max session, the architect/reviewer). Owner B = laptop B (teammate: Codex + Claude Pro). Nobody edits files outside their own module. Every PR must pass `scripts/test.sh`. Architect reviews and merges.

| # | Task | Owner | Branch | Brief | Status |
|---|------|-------|--------|-------|--------|
| 1 | Scaffold: plan, contracts, sample run.json, briefs | A | main | — | ✅ done |
| 2 | `web/index.html` — the stage (three.js) | B | `web/stage` | tasks/stage.md | ✅ merged |
| 3 | `server.py` — FastAPI: /run.json, /order, /runs, /snapshots; netlistsvg vendoring | B | `web/api` | tasks/api.md | ✅ merged |
| 4 | `engine/orders.py` — order generator, 3 pools, Yosys baseline | A (subagent) | `engine/orders` | tasks/orders.md | ✅ merged |
| 5 | `engine/inspector.py` — flatten, exhaustive test, fab rules, scoring | A (subagent) | `engine/inspector` | tasks/inspector.md | ✅ merged |
| 6 | `engine/client.py` — Crusoe calls, schema, thinking, caps, metrics, parallel | A (subagent) | `engine/client` | tasks/client.md | 🟨 in progress (subagent) |
| 7 | `engine/agents.py` + `library.py` — architect, designers, assembler | A | `engine/agents` | — | ✅ merged |
| 8 | `engine/investigator.py` — categories, loop detector, lessons | A | `engine/agents` | — | ✅ merged |
| 9 | `engine/gate.py` — one change per shift, validation, keep/rollback, snapshots | A | `engine/gate` | — | ✅ merged |
| 10 | `engine/runner.py` — shifts, exam mode, parallel, run.json | A | `engine/runner` | — | ✅ merged |
| 11 | 2-order smoke run end to end | A | main | — | ✅ done (2 orders, v1→v2, $0.09) |
| 12 | 14:00 long run (8 shifts) + exam v1/v4/v8 | A | — | — | 🟨 running since ~11:20 |
| 13 | README (ablation table, kept/rejected changes, disclosure) | B | `docs/readme` | — | 🟦 assigned (tools/report.py fills the numbers) |
| 14 | 1-min video (record real stage → HyperFrames) | B | — | — | ⬜ todo |
| 15 | Rehearse ×5, projector test, submit by 16:45 | both | — | — | ⬜ todo |

| 16 | `web/present.html` — presentation mode, one scene at a time (Opus subagent) | A | `web/present` | — | ✅ merged |
| 17 | `web/ops.html` — judge page: 3D chip, Circuit Test with switches/lamps, Compare, logs, lessons (Opus subagent) | A | `web/ops` | — | ✅ merged |
| 18 | `web/fab.html` — dark-glass dashboard (sidebar, pipeline strip, design workspace, charts) | A | `web/fab` | — | ✅ landed 5f06337 |
| 19 | `web/home.html` — plain-English page: chip cards, 3D assembly replay, live circuit test, lessons, diary, scoreboard; served at `/` | A | `web/home` | — | ✅ landed 595b700 |
| 20 | `web/compare.html` — judge's Compare: past exam order or typed note, two versions side by side, linked switches, verdict | A | `web/compare` | — | ✅ landed fa9f443 |
| 21 | `web/dash.html` — dashboard from the hand-drawn wireframe: Version/Chip/Compare/Run, Order → 3D build → Circuit test, graphs, log, lessons by version | A | `web/dash` | — | ✅ landed 6c43348 |
| 22 | runner `--live`: parallel judge orders, events published as they happen (`run.json.live_runs`), `POST /order {note}` → real order | A | main | — | ✅ 7e54c54, rehearsed 14:50 |

**Freeze:** 15:15 (moved from 14:30 for the plain-English pages). Runner is in `--live` mode since 14:43; exams final v1 12.5% · v5 37.5% · v8 40%. **Cut order if slipping:** live race → recorded comparison · agent tree → text list · exam v1+v8 only · lights-off/gauges · VL inspector · night shift. **Never cut:** inspector, live order, one real failure, exam numbers.
