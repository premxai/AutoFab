# AUTOFAB — Execution Plan (final, v3)
Recursive Agents Hackathon · Sat Oct 17 2026 · Shack15, 1 Ferry Building, SF · doors 09:00 · hacking 10:45 · submissions 17:00 · 3-min live demo + Q&A · 1-min video · public repo · team ≤ 4.
**First thing tomorrow: copy this file into the repo as `docs/PLAN.md`.** (This session's folder is temporary.)

## 0. Mission
**One-liner:** "We built the factory, not the chips. It practices on fresh orders, learns from its own failures, and every version sits the same 40-chip exam it has never seen."
**Track:** Version N+1 (primary). Also shown: Done Means Done (self-written checks, independent inspector, loop detection, rare human ping) and Shared Brain (lessons index + verified parts library on a cached prefix).
**Rubric:** Technicality 40 · Creativity 25 · Live demo 20 · Future/AI impact 15. **Prizes targeted:** 1st ($14k) + Best Use of Nemotron (RTX 5090).
**Thesis line:** "The harness got smarter. Then the model did too." (second half only if the night shift is served)
**Non-negotiables:** fake nothing · every number on screen comes from `run.json` · features stop at 14:30 · submit by 16:45.

## 1. Verified facts (real Crusoe API, Oct 16–17; every answer code-checked)
| Fact | Consequence |
|---|---|
| Exact ids: `nvidia/Nemotron-3.5-Lightning-30B-A3B`, `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`, `nvidia/NVIDIA-Nemotron-3.5-Super-VL`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`. All list `structured_outputs`, `response_format`, `thinking`, `reasoning_effort`, `tools`. | Use these strings; confirm with `GET /v1/models` at 10:45 |
| A JSON schema described in prose, or "use as few gates as you can", makes the models think forever (20–75k chars, no answer). **Strict `response_format` json_schema fixes format 100%.** | v1 = no schema (bare). `schema_on` = the first kept change |
| Lightning, thinking off: fast (2 s) and **wrong on everything** (3–6-input gates, 0/16). | `no_fast_lane` change |
| Lightning, thinking on: ✅ comparator 17 g/17 s, ✅ NAND-only adder 9 g, ✅ 2-bit counter, ✅ **assembly of a 4-bit add/sub from library parts 512/512 in 9 s**; ❌ **never finishes a novel 4-input function** (66k chars at 30k tokens). | `route_novel_to_super` change; a spiral = failure category `spiral` |
| Super, thinking on: ✅ every rung incl. novel functions, but **19–23 gates where 5–8 suffice**, 116–137 s, 136 tok/s. Super thinking off: wrong. | Headroom on gates, time, cost even when correct |
| Crusoe proxy **rejects `reasoning_budget`** (403); `reasoning_effort: low` answers but wrong; template `low_effort`/budget do nothing. | **Loop-cutter is client-side** (stream `reasoning_content`, abort on repeated n-grams, re-route) + max_tokens caps |
| `cached_tokens` reported on **Super** (2304/2962 on the 2nd identical-prefix call) and DeepSeek; **not on Lightning** (latency still drops 0.55→0.25 s). | Cache gauge reads Super's calls; say so |
| Rate limits per project per model: **30 RPM / 500k TPM without a card, 600 RPM / 2M TPM with one.** | Add a card. Semaphore per model. Spread roles across models. |
| Fine-tune endpoint `api.intelligence.crusoecloud.com/v1` needs a browser-style User-Agent; only Nemotron there is **3.5 Nano** (`ftmodel-6c22bf52-fb65-4bd5-94c4-736f0a7d33f0`); batch_size/learning_rate must be `"auto"`. A 40-example LoRA job **succeeded in 203 s** (model `ftmodel-933c3bd2-…`, train loss 0.81). Tuned models are **not** callable on serverless; self-serve flavors exist for Lightning (4×H100 $22/h, 8×H100 $44/h) but **none for Nano**. | Night shift trains fine; **serving needs Crusoe staff** (ask at 10:00). Fallback: show the training job + loss. |
| Gate baseline via `yowasp-yosys` works on this Windows box (4-input lock → **5 gates**); netlistsvg renders our netlists to real gate-symbol SVGs. | "gates vs best known" is a real number; schematics for free |
| Yesterday's spend: cents. Full day estimate < $25. | $4.50 + the $50 form + a card |

## 2. Product architecture (runtime)
### 2.1 The loop
Order → Architect plans parts + writes the definition of done → PartDesigners design (gates or library instances) → Assembler wires → **Inspector (code)** flattens, tests every input, checks fab rules, scores, writes a plain-English note → ≤3 attempts with the note fed back → pass: parts join the library; fail: Investigator categorizes, detects loops, writes a lesson in the fault's words → **once per shift** the Gate proposes ONE change from the menu → validated on a fresh batch → keep or rollback → snapshot vN.
### 2.2 Model stack (all Nemotron on Crusoe)
| Role | Model | Thinking | Notes |
|---|---|---|---|
| Architect | Super 120B | on | plan + definition of done + spawns part agents |
| PartDesigner | Lightning (routing table may send rung-2/3 to Super) | on | reads lessons index + library first |
| Assembler | Lightning | on | wires parts; every port must be connected |
| Inspector | code | — | never trusts self-reports |
| Inspector-with-eyes (should-have) | Super VL | on | reads a Pillow-drawn PNG of the failed circuit, names the wrong wire |
| Investigator | Lightning | on | categories: format · wrong_logic · assembly · rules · budget · spiral; n-gram loop detector; lesson writer |
| Gate | Super | on | one change per shift; acceptance = gain beats noise AND cost justified |
| Screening (optional) | Nano | off | cheap triage |
`team.json` in the NemoClaw agents-manifest shape (`agents[].id/model/description`, `subagents.maxSpawnDepth`).
### 2.3 Orders (the ladder: difficulty = novelty, not size; 3–6 inputs; one-line everyday names)
1 "calculator that adds two numbers" (assembly; demo hero `7+5=12`) · 2 "door lock that opens only for codes 3, 9, 13, 14" (novel single-output; Lightning can't) · 3 "lock with green/red lights for different codes" (novel multi-output) · 4 "same lock from only 9 NAND chips" (NAND-only/budget) · 5 "traffic light cycling green→yellow→red" (sequential) · 6 "majority vote of 3 judges", "digit display for 3", "parity detector".
**Three pools from one generator, different seeds:** Practice (learn; ~10/shift) · Validation (Gate tests a change; ~10/proposal) · **Exam (40, seed frozen at 10:45, never seen while learning; benchmark mode = read-only).** Hidden fab rules on every order: fan-out ≤ 4, max depth, no unused gates, every pin wired, bus widths, allowed gate set, gate budget. **Exam pass = correct AND rules AND budget AND within 3 capped attempts.** Each order carries `best_known_gates` from Yosys/ABC.
### 2.4 v1 and the Gate's MENU
**v1 (bare):** Lightning everywhere, thinking on, no schema, no lessons, library = primitives only, 3 attempts, caps 12k tokens / 120 s.
**MENU:** 1 `schema_on` · 2 `no_fast_lane` · 3 `route_novel_to_super` ("stage router", NVIDIA's "plans route up, execution routes down") · 4 `loop_cutter` (client-side) + per-role caps · 5 `tidy_tool` (dedupe gates, double-NOT, dead gates) · 6 `fanout_buffer_rule` · 7 `library_first` · 8 `stable_prefix` (lessons/library/schema first, order last → MemoryAlloy hits). ≥7 independent failure categories + one change per shift ⇒ v2 cannot max out; the climb takes ≥5 shifts by construction. Shift log in autoresearch style: `keep: schema_on pass=.35 cost=.31` / `revert: super_everywhere pass=.35 cost=1.24`.
### 2.5 Data contracts (frozen at 10:45; only the architect edits)
**Order** `{id, pool, rung, title, inputs[], outputs[], allowed_gates[], gate_budget|null, truth{...}|sequence[], best_known_gates, seed}`
**Blueprint** (schema-enforced) `{inputs[], outputs{name:signal}, instances[{name, part, wire{port:signal}}], gates[{name, type∈AND|OR|XOR|NOT|NAND, inputs[1-2], output}]}`
**Inspection** `{pass, correct:"512/512", rules{fanout,depth,unused,pins,budget}, gates, best_known_gates, attempts, tokens, thinking_chars, cached_tokens, cost_usd, time_s, ttft_s, failure_category, note}`
**Lesson** `{id, when, pitfall, verification, category, born_shift, hits}`  **Snapshot** `{version, created, playbook[], routing{role:{model,thinking,max_tokens}}, tools[], schema_on, library[], change_log[{shift, proposal, verdict, delta}]}`
**run.json** `{shifts[{version, practice[], validation[], change, exam?{pass_rate, by_rung, categories}}], live{...}}` + Yosys-JSON export per chip for netlistsvg.
### 2.6 Night shift (optional finale)
Verified designs (single-turn: order → blueprint) → JSONL → LoRA on Nano 3.5 (~3–4 min) → if staff enable a flavor: deploy, run the exam as v9, delete the deployment after the demo. Else: show job id + loss on the ablation card.

## 3. Tech stack (decided; boring on purpose)
- **Python 3.13** · `openai` (async) · `fastapi` + `uvicorn` · `yowasp-yosys` (gate baseline) · `pillow` (VL image, optional) · `z3-solver` (optional bounded FSM check). Stdlib for everything else. JSON on disk, no DB, no Docker.
- **Node 22 only for `netlistsvg`** (`npm install netlistsvg`; vendor `built/netlistsvg.bundle.js` + `elk.bundled.js` into `web/`).
- **Stage:** one `web/index.html`, vanilla JS, **three.js 0.186.1 via import map** (`https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js`, addons at `.../examples/jsm/`), `dagre@3.1.1` CDN for layout, CSS2DRenderer labels. Fallback: last night's 2D canvas mock (`assembly-mock.html`).
- **Video:** OBS screen recording of the real stage → HyperFrames (installed in this session) for title cards + captions → MP4.
- **Not allowed:** React, build steps, databases, Docker, new frameworks, anything a judge can't see.

## 4. Repo, branches, discipline
```
autofab/  README.md  docs/PLAN.md  TASKS.md  scripts/test.sh  team.json  requirements.txt
  engine/ orders.py inspector.py client.py agents.py investigator.py gate.py runner.py library.py yosys_io.py
  web/ index.html netlistsvg.bundle.js elk.bundled.js
  runs/ snapshots/ orders/exam_seed.json samples/run.sample.json
```
- Public repo from the first commit. `main` protected. One branch per module: `engine/orders`, `engine/inspector`, `engine/client`, `engine/agents`, `engine/gate`, `engine/runner`, `web/stage`. One owner per branch; nobody touches another module's files.
- Every PR: `scripts/test.sh` green (offline checker tests from last night + a 2-order smoke run). Architect reviews every diff. Squash merge with timestamps.
- `TASKS.md` = the only status board (module · owner · branch · status · test command). Updated by the architect.
- README disclosure line: "the exhaustive-test checker and API harness were built the night before as a feasibility spike; everything else was built on Oct 17."

## 5. Build team (AI subscriptions, assigned)
| Who | Builds | Why |
|---|---|---|
| **Claude Max (this session, Fable 5.1) = architect + sole reviewer** | contracts, stage spec, `agents.py`, `investigator.py`, `gate.py`, `runner.py`, integration, demo script, every PR review | judgment work; a subtle bug here fakes the result |
| **Subagents from this session (Sonnet 5.5)** | `orders.py`, `inspector.py` (port + fab rules + scoring), `client.py`, `yosys_io.py` | mechanical, fully specified, testable |
| **Subagent (Opus 5.5), own branch `web/stage`** | the three.js stage against `samples/run.sample.json` | design-heavy; never waits on the engine |
| **Codex Plus** | FastAPI endpoints (`GET /run.json`, `POST /order`), `scripts/test.sh`, requirements, repo scaffolding, netlistsvg vendoring | boilerplate |
| **Claude Pro (30% left, resets Sat afternoon)** | README, video script, demo cue card, afternoon UI polish | the spare tank when Max is integrating |
| **Neon AI gateway ($500) + Nebius Token Factory ($90)** | fuel for extra coding agents if subscriptions run dry; **pipeline smoke tests** with cheap models (Nebius lists Nemotron 3 Super, not Lightning) via `PROVIDER=nebius|neon` in `client.py` | **never for shifts, exams or the demo — every judged number is from Crusoe** |
| **HyperFrames** | the 1-minute video | packaging ≈ half the submission |
**Skills to install before agents start:** `npx skills add cloudai-x/threejs-skills` · `npx skills add https://github.com/anthropics/skills --skill frontend-design` · superpowers plugin, use only `verification-before-completion`, `subagent-driven-development`, `writing-plans`. (Anatomy: at most a hero still image; not the live stage.)
**Rules:** agents don't talk to each other; integration happens through the contracts. Every agent prompt starts with the contracts and ends with "run `scripts/test.sh` before reporting."

## 6. Stage design spec (one page; the stage agent builds to this)
- **One screen.** Board 60% (left) · right column: team list (agent · model · state), inspector line (plain English), lesson card · bottom strip: version shelf `[v1][v2]…[v8]` + chip picker + **Race** button, one scoreboard line (exam v1/v4/v8 pass %, failure-category counts), small gauges (tok/s, TTFT, cache %, $/chip), **Lights** toggle, attempt counter.
- **Camera:** isometric orthographic at (1,1,1), OrbitControls, re-fit on resize. **Board:** dark slab + grid. **Blocks:** rounded boxes = **gates for small chips (≤20), library parts for assembled chips, click to expand one level** — never deeper. Short labels only (`AND`, `XOR`, `FA0`, `RESULT`). **Traces:** Manhattan fat lines that draw themselves (400 ms, animate `instanceCount`). **Pulse:** emissive sphere riding a CurvePath on test. **States = colors:** blue building · green pass · **red fail (pulse) + the wrong trace in red** · amber repair. Selective bloom on emissive only.
- **Palette (4 tones + 1 accent):** bg `#0b0f14`, slab `#0f1b17`, panel `#141c25`, text `#cfd8dc`; accent cyan `#38e8ff`; status green `#3ddc84`, amber `#ffc857`, red `#ff5c6c`. Monospace numbers. No words inside the scene except block labels.
- **Events from run.json:** `order` → type-in; `spawn` → team list; `place part` → block drops in; `wire` → trace draws; `test` → pulse + RESULT shows `7 + 5 = 12 ✓/✗`; `fail` → red + inspector line; `retry` → amber + counter; `pass` → green; `lesson` → card; `snapshot` → shelf gains a version.
- **Race:** two boards side by side, same order, two versions; attempt counter, time, gates, cost under each. **Replay** for chip 1; live for the judge's order (`POST /order`) with a pre-run fallback.
- **Schematic view:** netlistsvg SVG of the current chip in a side drawer (also exported to README).
- **Decision rule:** if the 3D stage isn't solid by **12:00**, ship the 2D mock wired to run.json. The demo never depends on 3D landing.

## 7. Timeline (Sat Oct 17)
| Time | Architect (Claude Max) | Engine subagents / Codex | Stage (Opus subagent) + teammate |
|---|---|---|---|
| 09:00 | arrive, Wi-Fi, **ask Crusoe staff about serving the tuned Nano / Lightning fine-tune**, card on account | repo scaffold, requirements, `scripts/test.sh` | install skills |
| 10:45 | **freeze exam seed**; write contracts + `run.sample.json`; `TASKS.md` | `orders.py`, `inspector.py`, `client.py`, `yosys_io.py` on branches | `web/stage` against the sample |
| 11:45 | review + merge engine PRs; start `agents.py` | FastAPI endpoints; netlistsvg vendoring | stage: blocks, traces, pulse |
| 12:30 | `investigator.py`, `gate.py` | smoke test 2 orders end-to-end | 3D go/no-go at 12:00; wire to run.json |
| 13:30 | `runner.py` (shifts, exam mode, parallel, run.json) | VL image path if time | shelf + race + scoreboard |
| **14:00** | **start the 8-shift run** (+ fine-tune job if going) | — | replay mode, lights-off |
| **14:30** | **FEATURE FREEZE** | — | — |
| 14:30–15:30 | README (ablation table, kept/rejected changes, disclosure), rehearse ×5, projector test | | |
| 15:30–16:15 | record video (2 takes) → HyperFrames titles/captions | | |
| 16:15–16:45 | **submit**: repo public, video link works, all teammates added | | |
**Cut order if slipping:** live race → recorded comparison · agent tree → text list · exam v1+v8 only · lights-off/gauges · VL inspector · night shift. **Never cut:** inspector, live order, one real failure, exam numbers.

## 8. Built around Crusoe (what their judges see)
Managed Inference (every call; ids from `/v1/models`) · Nemotron family routing learned by the Gate · structured outputs = first kept change · thinking controls = learned policy · **MemoryAlloy** = the Shared Brain prefix, cache % rising by version (Super's `cached_tokens`) · per-model rate limits = parallelism spread across models, headers into a gauge · usage × price = real $ per chip · TTFT/tok/s live · Serverless Fine-Tuning = the night shift · self-serve deployment = v9 if enabled. Precedent to cite: Crusoe's own Deep Agents blog hit 86.6% by evolving the harness only. Pitch: "Infrastructure wasn't the bottleneck (their words). ~400 chip builds in an afternoon for ~$20; the bottleneck was the team learning, and it learned."

## 9. Demo (3 min), video (1 min), Q&A
**Demo:** type the order → team spawns → gates assemble → inspector line + judge types `7 + 5` → wrong, red wire, note → fix, re-assemble → `12 ✓` → lesson card → **shelf race on a door lock: v1 fails 3 tries, v8 passes first try, fewer gates** → scoreboard line (v1/v4/v8 on the frozen 40 + category counts) → lights off (+ night-shift line).
**Video:** same beats in 60 s from the same screen; HyperFrames title + captions; end card "AutoFab · built on Crusoe with NVIDIA Nemotron".
**Q&A:** "Isn't this Yosys?" → Yosys doesn't take a vague order, assemble from a library, verify itself, or get better overnight; we benchmark against it. · "Rigged?" → exam frozen at 10:45, rejected changes on screen, unedited v1 traces, pick any version + any chip. · "Why Nemotron?" → four family members in built-for roles, learned thinking/routing policy, Super VL inspection, open weights for the night shift. · "Dashboard?" → the chip is the product. · "Why a team?" → the chip hierarchy is the team hierarchy; the inspector is independent by design. · "Gates vs humans?" → TC-Bench: raw LLMs use 38–1075% more gates than humans; ours closes the gap by learning.

## 10. Submission checklist & README outline
Form: track Version N+1; one-liner; "also demonstrates Done Means Done and Shared Brain"; repo public; video accessible; every teammate added.
README: pitch · the loop diagram · **ablation on the frozen 40: bare → team v1 → evolved v8 (→ night shift v9)** · kept and rejected changes with deltas · what the agents wrote (lessons, tools) · "Built on Crusoe" (endpoints/fields, fine-tune job id, exam run ids) · honesty notes (simplified fab rules; spike disclosure; which numbers are measured) · run instructions · team.

## 11. Risks & fallbacks
Live hang → replay chip 1, caps everywhere, pre-run fallback for the judge's order · Gate finds nothing → Investigator feeds categorized counts + failure text; menu is fixed · rate limits → card + semaphores · 3D fails → 2D mock · fine-tune serving blocked → training-only finale · Wi-Fi → everything local except Crusoe calls; pre-recorded runs on disk · scope creep → 14:30 freeze, cut order above.

## 12. Toolbox appendix (snippets)
- **Yosys baseline:** write `.names` BLIF from the truth table → `read_blif o.blif; synth -top o; abc -g AND,NAND,OR,NOR,XOR,XNOR; opt_clean; stat; write_json o.json` (NAND rung: `abc -g NAND`). cwd-relative paths only.
- **netlistsvg:** ours → Yosys JSON (nets as ints; cells `$_AND_`/`$_NAND_`/`$_XOR_`/`$_NOT_` with ports A,B,Y; `$_DFF_P_` D,C,Q) → `await netlistsvg.render(netlistsvg.digitalSkin, json)`.
- **Rate limits:** `asyncio.Semaphore(rpm//60)` per model; backoff 1 s doubling + jitter, cap 60 s; read `x-ratelimit-remaining-requests/tokens`.
- **Gate acceptance:** `accept = (delta_pass > noise_floor) and (cost_ratio <= gain_ratio) and no_regression_by_rung`; log hypothesis + outcome.
- **Lesson template:** When-to-use · Pitfall (the fault, verbatim) · Verification (the check to run) · retire after N unused shifts.
- **Loop-cutter:** stream reasoning; if any 12-token n-gram repeats ≥ 6 times in the last 4k chars → abort, mark `spiral`, re-route per policy.
- **Thinking kwargs:** `chat_template_kwargs: {"enable_thinking": true|false}`; never send `reasoning_budget` (403).
- **three.js import map:** `{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"}}`; RoundedBoxGeometry + emissive + selective UnrealBloomPass; Line2 draw-on via `instanceCount`; CSS2DRenderer labels; dagre LR layout.
- **Pitch sources:** Karpathy autoresearch (Mar 2026) · Cadence + NVIDIA autonomous design engineer on Nemotron + OpenShell (Jun 2026) · "When Agents Do Not Stop" (arXiv, Jul 2026) · TC-Bench/CircuitMind (arXiv 2504.14625) · Nemotron 3.5 Super VL released Oct 15.

## 13. Accounts & hygiene
Crusoe: card on the account (rate limits) · $50 credits form submitted · key lives in `~/.crusoe_key` (never in the repo; revoke after the event; `cls` the terminal) · Discord #crusoe for the serving question · Nebius/Neon keys only in `client.py` env, smoke tests only.
