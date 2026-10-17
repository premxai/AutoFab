# Task 2 — The stage (`web/index.html`) · Owner B · branch `web/stage`

## What
One dark single-page stage that animates a chip being built, tested, failing, fixed and passing, driven ONLY by `run.json` events (the page computes nothing). Ripple-style: chunky blocks, traces that draw themselves, four colours, plain-English inspector line. three.js 0.186.1 via CDN import map; no build step, no framework.

## Files you own
`web/index.html` (+ optional `web/stage.js`, `web/stage.css`). Read-only for you: `docs/CONTRACTS.md` (§7 ChipRun, §8 run.json), `samples/run.sample.json`, `web/mock-2d.html` (last night's 2D mock, the fallback look).

## Spec (build to this, not to a vibe)
- **Layout:** board 60% left · right column: team list (agent · model short name · state), inspector line (plain English, from `fail.note`), lesson card (from `lesson.text`) · bottom strip: version shelf `[v1][v2]…` from `versions`, chip picker, **Race** button, one scoreboard line (exam pass % per version + category counts), small gauges from `gauges`, **Lights** toggle, attempt counter.
- **Camera:** isometric `OrthographicCamera` at (1,1,1)·d + OrbitControls; refit on resize. **Board:** dark slab + GridHelper.
- **Blocks:** `RoundedBoxGeometry`, `MeshStandardMaterial({emissive, emissiveIntensity: 2, toneMapped: false})`, `CSS2DRenderer` labels (block `label` only). One `place` event = one block drops in (scale 1.4→1, 250 ms). Layout: columns by order of `place`, or `dagre@3.1.1` (LR) if you have time.
- **Traces:** `Line2/LineGeometry/LineMaterial` Manhattan paths that draw themselves over 400 ms by animating `geometry.instanceCount` (setDrawRange does NOT work on Line2). `wire.from`/`to` are `signal` or `block.port`; route from the source block's right edge to the target block's left edge.
- **Test:** emissive sphere riding a `CurvePath` through the blocks in place order; RESULT block shows `a + b = got ✓/✗` (from `test.inputs`, `expected`, `got`).
- **States = colours:** blue `#38a0ff` building · green `#3ddc84` pass · red `#ff5c6c` fail (block pulses; `bad_wires` traces turn red, 5 px) · amber `#ffc857` repair (`retry`). Selective `UnrealBloomPass` on emissive only (layers trick). Palette: bg `#0b0f14`, slab `#0f1b17`, panel `#141c25`, text `#cfd8dc`, accent cyan `#38e8ff`.
- **Events** (`docs/CONTRACTS.md` §7): `order` → title appears · `spawn` → team list row · `plan` → definition-of-done chips · `place` · `wire` · `test` · `fail` · `retry` · `pass` · `lesson` · `spiral` (team row flashes red, counter of thinking chars) · `human_ping` · `done`. Replay a ChipRun by scheduling events on `t` (scaled by a speed slider, default 2×).
- **Race:** two boards side by side, same order, two versions; under each: attempts, time, gates, cost (from `inspection`).
- **Lights:** page goes near-black, board keeps glowing, counter "Humans on floor: 0" stays.
- **Data:** poll `GET /run.json` every 1 s (fallback: `samples/run.sample.json` when the fetch fails). Picker lists `shifts[*].practice[*]` and `exam[*].runs[*]` by title. `live` (if non-null) auto-plays.
- **Go/no-go at 12:00:** if 3D isn't solid, wire `web/mock-2d.html`'s canvas approach to run.json instead. The demo never depends on 3D.

## Acceptance
`python -m http.server 8765` from repo root → `http://localhost:8765/web/` loads with **zero console errors**, plays `run.sample.json` run_00001 end to end (red wire visible at the `fail`, green at `pass`), run_00002 shows the spiral + human ping, the shelf lists v1/v2, Race shows two boards, Lights works. Phone-width doesn't matter; a 1920×1080 projector does.

## Paste this into Codex / Claude Code on laptop B
```
Read docs/CONTRACTS.md (§7 and §8), samples/run.sample.json and tasks/stage.md. Build web/index.html exactly to tasks/stage.md: a three.js 0.186.1 (CDN import map: "three":"https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js", "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/") isometric stage that replays ChipRun events from run.json. Use RoundedBoxGeometry + emissive materials + selective UnrealBloomPass, Line2 traces drawn on by animating instanceCount, a CurvePath pulse for tests, CSS2DRenderer labels. The page computes nothing; it only animates events. Work only in web/. Branch web/stage. Serve with `python -m http.server 8765` and verify zero console errors on run_00001 and run_00002 before you report. Commit every 20 minutes.
```
