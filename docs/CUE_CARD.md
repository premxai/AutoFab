# AutoFab — 3-minute live demo (cue card)

**Before you walk up:** `python -m engine.runner --live --parallel 4` and `uvicorn server:app --port 8000` running · browser full-screen at http://localhost:8000/ (dashboard, light mode) · a second tab on `/web/compare.html?order=ord_x4242_001&a=v1&b=v8` · the live door-lock order already posted from Compare about **4 minutes before** your slot so it finishes on stage · hardware acceleration on · Wi-Fi checked.

**The one line (say it first, say it last):**
> "We changed nothing between version 1 and version 8. The factory wrote its own lessons, built its own parts, and tested every change it proposed. Same exam, same model: 5 of 40 became 16 of 40."

---

## Minute 1 — the problem, in plain words (0:00–1:00)

| Time | On screen | Say |
|---|---|---|
| 0:00 | Dashboard, chip **Calculator**, step **1 Order** | "A chip is just a bunch of tiny switches wired together. Wire them right and it adds two numbers. Wire one pin wrong and it adds wrong, and you can't see it. That's the whole job of a chip fab: get every wire right, every time." |
| 0:15 | Press **▶ 2 3D build** · Replay | "We built a factory that does this job with AI agents. A planner splits the order into blocks. Designers build the blocks. A wirer connects them. Watch." *(let the blocks drop in silence for 3 seconds)* |
| 0:30 | The red wire + caption | "There. A wrong wire. And this is the important bit: no AI grades the AI. A piece of code tries **every single input**, all 256 of them, and catches it." |
| 0:45 | Press **3 Circuit test** · set 7 + 5 · flip one switch | "Fixed on the next try. Seven plus five, twelve. Flip a switch, the current flows, the answer lights up. Every chip on this screen was checked this way." |

## Minute 2 — how it got better (1:00–2:00)

| Time | On screen | Say |
|---|---|---|
| 1:00 | Scroll to **Practice, shift by shift** | "Here's the part that matters. The factory ran eight shifts on its own. Ten fresh orders per shift. After each shift, an investigator agent reads what failed and writes the team a lesson." |
| 1:15 | Hover a dot · point at the **Gate** row | "Every shift it also proposed one change to how it works, and tested that change on a fresh batch. Eight proposals. Eight rejected. The factory refused to keep anything that didn't measurably help." *(pause)* "That's the brake. Self-improvement without a brake is just drift." |
| 1:35 | **Same 40 orders, every version** | "And here's the proof. Forty orders it never practiced on. Same model, same prompts, same budget. Version 1, empty notebook: five of forty. Version 8, seven lessons and seven tested parts it built itself: sixteen." |
| 1:50 | Point at the green chips | "Each green square is a real chip that passed an exhaustive check. Nothing on this page is typed in. It all comes from one file the factory writes." |

## Minute 3 — prove it live (2:00–3:00)

| Time | On screen | Say |
|---|---|---|
| 2:00 | Switch to the **Compare** tab, 4-bit calculator, v1 vs v8 | "Same order, two versions. Version 1 failed it. Version 8 passed it. Scroll: here's what version 8 knew that version 1 didn't." *(read the green 'helped' lesson aloud)* |
| 2:20 | Scroll down to the live door-lock build (posted earlier) | "And this one is live. A judge typed 'a door lock that opens for 3, 5 and 8' a few minutes ago. Both versions built it on Crusoe while we talked." |
| 2:35 | Flip the lock switches · both lamps | "Code 5: opens on both. Code 6: stays shut. The switches are linked, one flip tests both chips." |
| 2:50 | Back to the dashboard, step 2 | "Nemotron agents, Crusoe inference, every number from run.json." |
| 2:58 | Stop. Look up. | "We changed nothing. The factory did. Five of forty became sixteen. Questions?" |

---

## Speaker craft (the stuff that makes it land)

- **Open with the chip, not the architecture.** The first 15 seconds are for a person who has never heard the words "logic gate". Switches and wires, that's all.
- **Show, then say.** Press the button first, let it move, then explain. Never explain something the audience can't yet see.
- **Three silences.** After the blocks drop (0:20), after "eight rejected" (1:25), after the final number (2:58). Two full seconds each. Silence is what makes a number sound big.
- **One number per beat.** 256 inputs. Eight rejected. Five to sixteen. Don't stack numbers in one sentence.
- **Hands on the switches.** Physically flip them during the test. Judges remember the thing you touched.
- **Say "it", not "we".** The factory wrote the lessons. The factory built the parts. The factory rejected its own ideas. That is the RSI claim, so give the credit to the system every time.
- **Never apologise for the model.** If something spirals: "Real model, real latency. That's exactly the failure it writes lessons about." Then move to the next beat.
- **Repeat the one line.** First sentence and last sentence are the same idea. The judges' notes will contain it.

## If something stalls
- Live order not done: skip it, stay on the stored 4-bit calculator compare. Say "same model, same latency, here's this morning's run."
- 3D doesn't render: step 3 Circuit test does the same job with lights. Never more than 10 seconds of silence.
- Page frozen: F5. The factory keeps running; the page just reads a file.

## Q&A cheat sheet
- **Isn't it just better prompts?** Prompts never changed. Only the lessons the team wrote and the parts it built. Both are in the repo with timestamps.
- **Rigged?** Exam seed committed before the run; exam orders never used in practice; every rejected change is on screen; pick any chip, flip any switch.
- **Why did the Gate reject everything?** Each change was tested on a fresh batch of 12 and had to beat the noise floor without cost blowing up. None did. That's the point: it refused to drift. The gain came from the shared brain, not from tweaking.
- **Why only 40%?** The remaining failures are the small model thinking in circles on brand-new functions. The factory found no cheap fix and said so instead of hiding it.
- **Is the checker an LLM?** No. Exhaustive truth-table simulation plus fab rules, in code. Zero trust in self-reports.
- **Why Nemotron?** Lightning 30B does the work, Super 120B runs the Gate; open weights, fast, cheap enough to run 500 chips for two dollars.
- **Cost?** $2.02 for the whole run; $0.007 per chip at v1, $0.005 at v8, gates 1.74× best-known down to 1.29×.
- **Human in the loop?** Only a ping after 3 failed tries; nobody answered any during the run. The count is on screen.
- **Simplified?** Fab rules are a simplified design-rule check; chips are small, up to 6 inputs. The method scales; the demo doesn't need to.
