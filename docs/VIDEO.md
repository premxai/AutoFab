# AutoFab — 1-minute video storyboard

**Rules:** every shot is a screen recording of the real stage (`http://localhost:8000/`) playing real `runs/run.json` data. HyperFrames only adds title cards, captions and the end card. No mock-ups, no numbers typed by hand: every figure in a caption is copied from `python tools/report.py`. Target 60 s, hard cap 65 s. 1920×1080, 30 fps, hardware acceleration on, stage at 2× replay speed (set before recording). Record two takes.

**Fill in after the long run** (placeholders in `[brackets]`): exam pass v1 / v8, gates vs best known, cost per chip, which changes were kept or rejected, one real lesson text.

| # | Time | On screen (real recording) | Caption / voice-over | Notes |
|---|---|---|---|---|
| 0 | 0:00–0:05 | HyperFrames title on the dark stage background: **AutoFab** · "We built the factory, not the chips." | — | Track: Version N+1. |
| 1 | 0:05–0:13 | Stage, picker on *Calculator that adds two 4-bit numbers* (a real run). Order title appears, team list fills (Architect Super 120B, designers Lightning 30B). | "A team of Nemotron agents on Crusoe takes an order in plain English." | Use a real chip that fails once on attempt 1. |
| 2 | 0:13–0:23 | Blocks drop in, traces draw, pulse runs, RESULT turns **red** `7 + 5 = 10 ✗`, the wrong trace is red, inspector line shows the plain-English note. | "An independent inspector made of code tests every possible input. It doesn't trust the team." | Hold on the red trace for 1 s. |
| 3 | 0:23–0:30 | Amber repair, attempt counter 2/3, RESULT `7 + 5 = 12 ✓`, all green, lesson card appears. | "It fixes the wire, passes — and writes itself a lesson." | Read the lesson text verbatim from the run. |
| 4 | 0:30–0:42 | **Race** on a door lock order: left board v1 (3 attempts, red / spiral), right board v[N] passes first try; captions under each board show attempts, gates vs best, cost. | "Each shift the factory changes itself — one change, kept only if it wins on fresh orders. [v1] needs [3] tries. [vN] passes first time with [k] fewer gates." | If no true same-order pair exists, caption it "two different chips". |
| 5 | 0:42–0:52 | Bottom strip: version shelf, scoreboard line (exam v1 [x]% → v8 [y]%, failure categories shrinking). Cut to the shift log table from the README (kept ✓ / rejected ✗). | "Same 40-chip exam, never seen while learning: [x]% → [y]%. Rejected changes stay on the record." | Numbers from `tools/report.py` only. |
| 6 | 0:52–0:57 | **Lights** toggle: page goes dark, boards keep glowing, "HUMANS ON FLOOR: 0". | "Lights out. [N] human pings." | Use the real `human_pings` gauge value. |
| 7 | 0:57–1:00 | End card: **AutoFab · built on Crusoe with NVIDIA Nemotron** · repo URL. | — | Text only, no logos we don't have. |

## Recording checklist
1. Pull `main`, start `python -m engine.runner --live` and `uvicorn server:app --port 8000`; confirm the gauges move.
2. Browser full-screen (F11) at 1920×1080, hardware acceleration on (`chrome://gpu` shows "Hardware accelerated"), bookmarks bar hidden, notifications off.
3. Set speed to 2×, pick the chip, start OBS *before* pressing ▶ Replay.
4. Two takes; keep the one with no stutter. Do not alter stage content in post.
5. Drop the take into HyperFrames: titles at 0:00 and 0:57, captions as above, export MP4 ≤ 100 MB. Check the upload link works logged out.
