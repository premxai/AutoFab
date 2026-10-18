# AutoFab — 3-minute live demo (cue card)

**Before you walk up:** `python -m engine.runner --live --parallel 4` and `uvicorn server:app --port 8000` running · browser full-screen at http://localhost:8000/ (dashboard, light mode) · a second tab on `/web/compare.html?order=ord_x4242_001&a=v1&b=v8` · the live door-lock order already posted from Compare about **4 minutes before** your slot so it finishes on stage · hardware acceleration on · Wi-Fi checked.

**The one line (say it first, say it last):**
> "We changed nothing between version 1 and version 8. The factory wrote its own lessons, built its own parts, and tested every change it proposed. Same exam, same model: 5 of 40 became 16 of 40."

---

## The cut: six things a judge must see, in this order

| Time | Must show | On screen | Say |
|---|---|---|---|
| 0:00 | **Live build** | Dashboard · **▶ Run** · type "a door lock that opens for 3, 5 and 8" · Build. Step 2 follows it. | "A chip is tiny switches wired together. Wire one pin wrong and it's wrong, and you can't see it. So we built a factory of AI agents that gets the wires right, and here it is building a judge's order, live." |
| 0:40 | **Agent logs** | Agent log card (live dot) | "Planner started. Block designer built the lock. Wirer connected nine wires. Checker tried every code, all sixteen. No AI grades the AI; a piece of code does, and every line here is from the run file." |
| 1:10 | **Version improvements** | Scoreboard: 40 chips per version, +10 / +1 | "Forty orders it never practiced on. Version 1: five. Version 5: fifteen. Version 8: sixteen. Same model, same prompts, same budget." *(pause)* |
| 1:35 | **Improved learning** | Lessons by version · Practice chart, Gate row | "Seven lessons it wrote itself, filed under the version that wrote them. And eight changes it proposed to its own rules, all eight rejected by its own Gate on a fresh batch. It kept what helped and refused what didn't." |
| 2:00 | **Comparison build** | Compare tab · 4-bit calculator · v1 vs v8 · flip a switch | "Same order, two versions. Version 1 failed it. Version 8 passed it. Switches are linked: one flip, both chips answer." |
| 2:25 | **Proof of RSI** | Scroll to "What this version knew" · the green *helped* lesson | "This is the proof. Version 1 started with an empty notebook. Version 8 read this lesson, the exact one version 1 was missing on this order. Nobody wrote it. The factory did." |
| 2:50 | Close | Back to the live door lock, finished | "And the judge's order is done on both versions. We changed nothing. The factory did. Five of forty became sixteen. Questions?" |

**Timing:** the live lock takes 3–6 minutes on Lightning. Post it the second you walk up. If it is not done at 2:50, open the finished one from the chip menu: "here's the one from the last run."


## Demo picks (from the real run data)

| Part | Chip | Why | Open |
|---|---|---|---|
| 2 · finished chip | **Door lock, codes 0, 11, 15** · version 7 · validation batch, shift 7 | 2 tries: a real **wrong wire** turns red in the 3D replay, then it is fixed and passes all 16 codes | `http://localhost:8000/web/dash.html?run=vn7_v7_ord_v767_002&v=7` |
| 2 · backup | **Calculator that adds two 4-bit numbers** · version 8 · exam | 3 tries: got stuck thinking twice, then right on all 256 answers; ties to the "stop thinking in circles" lesson | `http://localhost:8000/web/dash.html?run=exam_v8_v8_ord_x4242_038&v=8` |
| 3 · live order | type **a door lock that opens for 3, 5 and 8** · latest version | rung 2, builds in 3–6 min; passed on v8 in rehearsal | Run button on the dashboard |
| 4 · compare | **Calculator that adds two 4-bit numbers plus a carry-in** · v1 vs v8 | v1 failed (unreadable plan), v8 passed first try, 512 answers; the missing lesson shows green | `http://localhost:8000/web/compare.html?order=ord_x4242_001&a=v1&b=v8` |
| 4 · backup | **Down counter 0, 3, 2, 1** · v1 vs v8 | v1 got stuck, v8 first try; the Tick button is fun to press | `http://localhost:8000/web/compare.html?order=ord_x4242_002&a=v1&b=v8` |

Other v1-failed / v8-passed exam orders if a judge asks for another: 3-bit adder (ord_x4242_004), odd-parity 5 bits (011), 3-bit adder with carry (014), door lock 7, 9, 13 (027), door lock 2, 8, 9, 13 (039).

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
