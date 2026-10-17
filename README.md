# AutoFab

**We built the factory, not the chips.** A team of NVIDIA Nemotron agents on Crusoe Managed Inference designs small logic chips from a plain-English order, verifies every one on every possible input, learns from its own failures, and proves the improvement on the same 40-chip exam it has never seen.

Recursive Agents Hackathon · San Francisco · Oct 17, 2026 · Track: **Version N+1** (also demonstrates *Done Means Done* and *Shared Brain*).

<!-- TODO(video): link to the 1-minute video once it is uploaded -->
**Video:** _TBD_ · **Live stage:** `uvicorn server:app --port 8000` → http://localhost:8000/

---

## The idea

Most agent demos show a model doing a task. AutoFab shows a *team that gets better at the job*, and shows the receipts.

- The product is a chip fab. You type an order ("a calculator that adds two numbers", "a door lock that opens only for codes 3, 9, 13, 14"). A team of agents plans it, designs the parts, wires them together, and an **independent inspector made of code** (not a model) tests every possible input and checks hidden fab rules.
- Between shifts the factory changes **itself**, one change at a time, from a fixed menu. A change is kept only if it wins on a fresh validation batch; otherwise it is rolled back.
- Every version of the factory sits the **same 40-chip exam** that was frozen before any learning started and is never used for learning.

## The loop

```mermaid
flowchart LR
  O[Order] --> A[Architect<br/>plan + definition of done]
  A --> D[Part designers<br/>library parts first]
  D --> S[Assembler<br/>wires parts]
  S --> I{{Inspector<br/>code: flatten, test every input,<br/>fab rules}}
  I -- pass --> L[(Library of verified parts)]
  I -- "fail, ≤3 attempts<br/>note fed back" --> D
  I -- fail --> V[Investigator<br/>category, loop detector, lesson]
  V --> P[(Lessons index)]
  P --> D
  V --> G[Gate: ONE change per shift]
  G -- "validate on fresh batch" --> K{Better?}
  K -- keep --> N[Snapshot vN]
  K -- rollback --> R[Rejected, logged]
```

## Results

> The numbers below are produced by `python tools/report.py` from `runs/run.json` (real Crusoe calls). Nothing here is typed by hand.

### Ablation on the frozen 40-chip exam

<!-- REPORT:EXAM — paste the "Exam" table from `python tools/report.py` -->
| Version | Pass rate | Gates vs best known | Attempts | Cost / chip | Failures by category |
|---|---|---|---|---|---|
| v1 | **12%** | 1.74× | 2.75 | $0.007 | format 9, wrong_logic 1, spiral 25 |
| v5 | **38%** | 1.32× | 2.48 | $0.006 | format 4, spiral 21 |
| v8 | **40%** | 1.29× | 2.42 | $0.005 | spiral 24 |

By rung: {'v1': {'1': 0.0, '5': 0.0, '2': 0.4, '3': 0.0, '6': 0.25, '4': 0.0}, 'v5': {'1': 0.38, '5': 0.25, '2': 0.7, '3': 0.17, '6': 0.75, '4': 0.0}, 'v8': {'1': 0.62, '5': 0.5, '2': 0.6, '3': 0.17, '6': 0.5, '4': 0.0}}
<!-- /REPORT -->
_Pending the long run._

Reading guide: bare = one cheap model with no schema, no lessons, no library · v1 = the starting team · vN = the team after N−1 kept changes. Exam pass means: correct on all inputs **and** every fab rule ok **and** within 3 capped attempts.

### Changes the factory tried (kept and rejected)

<!-- REPORT:SHIFTS — paste the "Shift log" table from `python tools/report.py` -->
| Shift | Version | Dominant failures | Proposal | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | v1 | format 1, spiral 5 | schema_on | **revert** | rung regression (old {'4': 0.0, '3': 0.0, '1': 1.0, '2': 0.67, '5': 0.0} -> new {'4': 0.0, '3': 0.0, '1': 1.0, '2': 0.0, '5': 0.0}) |
| 2 | v2 | spiral 5 | route_novel_to_super | **revert** | rung regression (old {'6': 1.0, '1': 0.67, '4': 0.0, '3': 0.0, '5': 0.0} -> new {'6': 1.0, '1': 0.0, '4': 0.0, '3': 0.0, '5': 1.0}) |
| 3 | v3 | format 1, wrong_logic 1, spiral 6 | loop_cutter | **revert** | pass 0.20->0.20 (noise 0.10), cost x1.01 |
| 4 | v4 | format 1, spiral 4 | schema_and_route | **revert** | rung regression (old {'1': 0.6, '2': 1.0, '3': 0.0, '5': 0.0, '4': 0.0} -> new {'1': 0.2, '2': 0.0, '3': 0.0, '5': 0.0, '4': 0.0}) |
| 5 | v5 | format 1, spiral 6 | schema_on | **revert** | pass 0.42->0.25 (noise 0.08), cost x1.20 |
| 6 | v6 | rules 2, spiral 4 | schema_and_route | **revert** | pass 0.25->0.00 (noise 0.08), cost x2.77 |
| 7 | v7 | rules 1, spiral 5 | schema_on | **revert** | pass 0.33->0.25 (noise 0.08), cost x1.25 |
| 8 | v8 | format 1, spiral 6 | — | **—** |  |
<!-- /REPORT -->
_Pending the long run._

### What the agents wrote for themselves

<!-- REPORT:LESSONS — paste the "What the team wrote for itself" list from `python tools/report.py` -->
7 lessons, 7 verified library parts.

- **L001** (format, shift 1, used 1×): when handing in a blueprint: *library part 'lock_or' is broken: name 'or1' is used twice (a gate and a instance); every name must be unique* → check that every gate has a name, a valid type, 1 or 2 inputs and an output, and every output maps to a real signal
- **L002** (spiral, shift 1, used 36×): when designing an unfamiliar function: *no answer within the thinking budget* → if no answer forms within a few hundred lines of reasoning, stop and hand the part to the stronger model
- **L003** (format, shift 3, used 1×): when handing in a blueprint: *runner error: 'inverter_in'* → check that every gate has a name, a valid type, 1 or 2 inputs and an output, and every output maps to a real signal
- **L004** (format, shift 3, used 3×): when handing in a blueprint: *library part 'full_adder_0': blueprint inputs ['a', 'b', 'cin'] do not match its ports ['a0', 'b0', 'cin']* → check that every gate has a name, a valid type, 1 or 2 inputs and an output, and every output maps to a real signal
- **L005** (rules, shift 6, used 3×): when checking fab rules before handing in: *signal 'op' feeds 5 gate inputs (limit 4)* → count fan-out per signal and depth before handing in
- **L006** (rules, shift 6, used 2×): when checking fab rules before handing in: *gate xor_a0_b0 is never used (its output 'x_a0_b0' feeds nothing)* → count fan-out per signal and depth before handing in
- **L007** (format, shift 8, used 0×): when handing in a blueprint: *name 'ff_q0' is used twice (a instance and a flip-flop); every name must be unique* → check that every gate has a name, a valid type, 1 or 2 inputs and an output, and every output maps to a real signal
<!-- /REPORT -->
_Pending the long run._

### Receipts

<!-- REPORT:RECEIPTS — paste the "Receipts" line from `python tools/report.py` -->
Total spend $2.02 · 109 tok/s · TTFT 2.48s · cache hit 0% · 100 chips/hour · human pings 49
<!-- /REPORT -->
_Pending the long run._

## The team (all NVIDIA Nemotron on Crusoe)

| Role | Model | Notes |
|---|---|---|
| Architect | Nemotron 3 Super 120B | plan, definition of done, spawns one designer per part |
| Part designer | Nemotron 3.5 Lightning 30B | reads lessons and verified parts first; novel functions can be routed to Super |
| Assembler | Nemotron 3.5 Lightning 30B | wires parts; every port must be connected |
| Inspector | **code** | flattens the blueprint, tests all 2ⁿ inputs, checks fab rules; never trusts a self-report |
| Inspector-with-eyes | Nemotron 3.5 Super VL | optional: looks at the drawn failed circuit and names the wrong wire |
| Investigator | Nemotron 3.5 Lightning 30B | failure categories, loop detection, lessons in the fault's own words |
| Gate | Nemotron 3 Super 120B | proposes one change per shift |

`team.json` holds the same roster in the NemoClaw agents-manifest shape.

**Failure categories:** `format` · `wrong_logic` · `assembly` · `rules` · `budget` · `spiral` (the model thinks forever without answering).

**The Gate's menu** (fixed; the Gate chooses and validation decides): `schema_on` · `no_fast_lane` · `route_novel_to_super` · `loop_cutter` · `tidy_tool` · `fanout_buffer_rule` · `library_first` · `stable_prefix`, plus routing experiments it is allowed to try and expected to see rejected.

## Why this is a fair test

- **Frozen exam.** 40 orders from a seeded generator; the seed is committed in `orders/exam_seed.json` (commit `212665e`, 10:43 on Oct 17, before the long run started). Practice and validation pools come from the same generator with different seeds. The exam is read-only.
- **The inspector is code.** Exhaustive truth-table check on every input, plus hidden fab rules (fan-out, depth, unused gates, pin wiring, gate budget, allowed gates). A model never grades a model.
- **Baseline you can check.** Each order carries `best_known_gates` from Yosys/ABC, so "gates vs best known" is a real number.
- **One change per shift**, kept only if gain beats noise *and* cost is justified *and* no rung regresses. Rejected changes stay on screen.
- **Every number on the stage is read from `runs/run.json`**; the page computes nothing.

## The stage

`web/index.html` (three.js, no build step) replays the real event log of any chip: blocks drop in, traces draw themselves, a pulse runs through the circuit, the inspector's plain-English note appears, the wrong wire turns red, the team repairs it, the lesson card lands. Version shelf, chip picker, **Race** (two versions on the same order side by side), **Lights** (lights-out view), and live gauges (tok/s, TTFT, cache hit, $ per chip). A live order (`POST /order`, a menu pick or a fresh unseen rung) is run by `python -m engine.runner --live` and replayed on the stage as it finishes.

## Run it

```bash
pip install -r requirements.txt
export CRUSOE_API_KEY=...                 # or put the key in ~/.crusoe_key (never committed)

python -m engine.runner --shifts 8 --exam v1,v4,v8   # the long run: writes runs/run.json and snapshots/
python -m engine.runner --live                       # serve live orders from the stage
uvicorn server:app --port 8000                       # the stage at http://localhost:8000/
python tools/report.py                               # prints the tables for this README
bash scripts/test.sh                                 # the test gate
```

No key? `python -m http.server 8765` from the repo root and open `/web/` to replay `samples/run.sample.json`.

## Built on Crusoe

Managed Inference for every call (model ids from `/v1/models`) · structured outputs (`response_format` JSON schema = the first kept change in our runs) · thinking controls · a client-side loop-cutter (the proxy rejects `reasoning_budget`) · per-model rate limits handled with a semaphore per model · `cached_tokens` for the cache gauge · usage × price = real $ per chip.

<!-- TODO(night shift): if run — fine-tune job id, loss, and whether the tuned model was served; otherwise delete this line -->
**Night shift (optional):** _TBD_

Full plan and measured API facts: [`docs/PLAN.md`](docs/PLAN.md). Data contracts: [`docs/CONTRACTS.md`](docs/CONTRACTS.md). Status board: [`TASKS.md`](TASKS.md).

## Honesty notes

- The exhaustive-test checker and the API harness (`tools/spike_checker.py`) were built the night before as a feasibility spike; everything else was built on Oct 17.
- Fab rules (fan-out, depth, budgets) are simplified versions of real design rules.
- Judged numbers come only from Crusoe calls. Other providers, if used, were for pipeline smoke tests only.
- AI coding assistants wrote much of the code under human direction; commits carry co-author lines.

## Team

<!-- TODO(team): names and GitHub handles of everyone submitting -->
_TBD_

## License

See [`LICENSE`](LICENSE).
