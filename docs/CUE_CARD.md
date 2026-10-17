# AutoFab — 3-minute live demo cue card

**Before you walk up:** `python -m engine.runner --live` and `uvicorn server:app --port 8000` running; stage open full-screen at http://localhost:8000/; hardware acceleration on; speed 2×; Wi-Fi checked; `runs/run.json` has the finished run (exam numbers on the scoreboard). Backup: if live hangs, press **Replay** on chip 1 (no network needed). If an order is posted while no runner is up, the pre-run fallback chip plays instead.

**First line:** "We built the factory, not the chips. It practices on fresh orders, learns from its own failures, and every version sits the same 40-chip exam it has never seen."

| Time | Do | Say |
|---|---|---|
| 0:00 | Stage up on chip 1 (adder). Press ▶ Replay. | "This is a chip fab run by Nemotron agents on Crusoe. Order: a calculator that adds two numbers." |
| 0:20 | Point at the team list as it fills. | "Super plans, Lightning designs each part, an assembler wires them." |
| 0:35 | Red wire + red `7 + 5 = 10 ✗`; read the inspector line aloud. | "The inspector is code. It tried every possible input and found the wrong wire. No model grades a model." |
| 0:55 | Amber repair → green `7 + 5 = 12 ✓`; lesson card. | "It repairs, passes, and writes itself a lesson:" (read it) |
| 1:15 | **Live order.** Pick an order in the Order menu (or "a new rung 2 order"), version = latest, **Place order**. | "Judge's choice — nobody rehearsed this one." |
| 1:30 | While it builds: point at the gauges (tok/s, TTFT, cache, $/chip). | "Real calls: [tok/s], [TTFT], [$/chip]. Every number on this screen is read from run.json." |
| 1:55 | Press **Race** on the door-lock order. | "Same order, two versions of the factory. v1 …" |
| 2:15 | Point at attempts / gates / cost under each board. | "v1 takes [3] tries and fails; v[N] passes first time with [k] fewer gates." |
| 2:30 | Scoreboard line + shelf. | "The frozen 40-chip exam: v1 [x]% → v8 [y]%. Each version gained one change; rejected changes are in the log." |
| 2:50 | Press **Lights**. | "Lights out. [N] humans on the floor." |
| 3:00 | Stop. | "AutoFab — the harness got smarter between shifts. Questions?" |

## If the live order stalls
Say: "Real models, real latency — here's the same order from this morning's run" and press **Replay** on that chip. Never leave more than ~10 s of silence.

## Q&A cheat sheet
- **Isn't this just Yosys?** Yosys doesn't take a vague order, assemble from a verified library, check itself, or improve between shifts. We use it as the yardstick: `best_known_gates` on every order.
- **Rigged?** The exam seed was committed at 10:43 (`212665e`) before the long run; the exam is read-only; rejected changes are shown; pick any version and any chip.
- **Why Nemotron?** Four family members in roles that fit them; the Gate learns the thinking/routing policy; open weights for the night shift.
- **Is the inspector an LLM?** No: exhaustive truth-table check plus fab rules, in code.
- **What did it actually learn?** Read the shift log: [kept changes + deltas]. Confirm against the finished run before claiming which change came first.
- **Cost?** [total $] for the whole run; [$/chip] at v1 vs v[N].
- **Humans in the loop?** One rare ping when 3 attempts are exhausted; the counter is on screen.
- **What's simplified?** Fab rules are a simplified version of real design rules; chips are small (≤ 6 inputs).
