# TASKS — the only status board
Owner A = laptop A (Prem + Claude Max session, the architect/reviewer). Owner B = laptop B (teammate: Codex + Claude Pro). Nobody edits files outside their own module. Every PR must pass `scripts/test.sh`. Architect reviews and merges.

| # | Task | Owner | Branch | Brief | Status |
|---|------|-------|--------|-------|--------|
| 1 | Scaffold: plan, contracts, sample run.json, briefs | A | main | — | ✅ done |
| 2 | `web/index.html` — the stage (three.js) | B | `web/stage` | tasks/stage.md | 🟦 assigned (issue open) |
| 3 | `server.py` — FastAPI: /run.json, /order, /runs, /snapshots; netlistsvg vendoring | B | `web/api` | tasks/api.md | 🟦 assigned (issue open) |
| 4 | `engine/orders.py` — order generator, 3 pools, Yosys baseline | A (subagent) | `engine/orders` | tasks/orders.md | ✅ merged |
| 5 | `engine/inspector.py` — flatten, exhaustive test, fab rules, scoring | A (subagent) | `engine/inspector` | tasks/inspector.md | ✅ merged |
| 6 | `engine/client.py` — Crusoe calls, schema, thinking, caps, metrics, parallel | A (subagent) | `engine/client` | tasks/client.md | 🟨 in progress (subagent) |
| 7 | `engine/agents.py` + `library.py` — architect, designers, assembler | A | `engine/agents` | — | 🟨 in progress (architect) |
| 8 | `engine/investigator.py` — categories, loop detector, lessons | A | `engine/agents` | — | ⬜ todo |
| 9 | `engine/gate.py` — one change per shift, validation, keep/rollback, snapshots | A | `engine/gate` | — | ⬜ todo |
| 10 | `engine/runner.py` — shifts, exam mode, parallel, run.json | A | `engine/runner` | — | ⬜ todo |
| 11 | 2-order smoke run end to end | A | main | — | ⬜ todo |
| 12 | 14:00 long run (8 shifts) + exam v1/v4/v8 | A | — | — | ⬜ todo |
| 13 | README (ablation table, kept/rejected changes, disclosure) | B | `docs/readme` | — | ⬜ todo |
| 14 | 1-min video (record real stage → HyperFrames) | B | — | — | ⬜ todo |
| 15 | Rehearse ×5, projector test, submit by 16:45 | both | — | — | ⬜ todo |

**Freeze:** 14:30. **Cut order if slipping:** live race → recorded comparison · agent tree → text list · exam v1+v8 only · lights-off/gauges · VL inspector · night shift. **Never cut:** inspector, live order, one real failure, exam numbers.
