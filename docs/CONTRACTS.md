# AutoFab Contracts (frozen 2026-10-17 10:45)
These shapes are the only way modules talk to each other. **Only the architect (Claude Max session, laptop A) edits this file.** Need a change? Open an issue titled `contract: ...`.

All model ids: `nvidia/Nemotron-3.5-Lightning-30B-A3B` · `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` · `nvidia/NVIDIA-Nemotron-3.5-Super-VL` · `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Endpoint `https://api.inference.crusoecloud.com/v1`.

## 1. Order (engine/orders.py → everyone)
```json
{"id": "ord_0001", "pool": "practice", "rung": 2,
 "title": "Door lock that opens only for codes 3, 9, 13, 14",
 "spec": "Output y = 1 only when the 4-bit input abcd (a = highest bit) equals 3, 9, 13 or 14; otherwise 0.",
 "inputs": ["a", "b", "c", "d"], "outputs": ["y"],
 "allowed_gates": ["AND", "OR", "XOR", "NOT"], "gate_budget": null, "flipflops_allowed": false,
 "truth": {"0000": {"y": 0}, "0011": {"y": 1}},
 "sequence": null,
 "best_known_gates": 5, "seed": 12345}
```
- `pool` ∈ `practice | validation | exam`. `rung` 1–6 (1 calculator/assembly · 2 novel single-output · 3 novel multi-output · 4 NAND-only or gate budget · 5 sequential · 6 misc one-liners).
- `truth` lists **every** input combination (key = bits in `inputs` order) for combinational orders.
- Sequential orders: `truth = null`, `flipflops_allowed = true`, `sequence = {"steps": 4, "expected": [{"q1":0,"q0":0}, {"q1":0,"q0":1}, ...]}` (state starts all-zero; one clock per step).
- `best_known_gates` from Yosys/ABC (`engine/yosys_io.py`); `null` if unavailable.
- Agents receive the order **without** `best_known_gates`. They never see fab rules.

## 2. Blueprint (what agents hand in; enforced by `docs/blueprint.schema.json` via `response_format`)
```json
{"inputs": ["a", "b", "c", "d"], "outputs": {"y": "g7"},
 "instances": [{"name": "fa0", "part": "full_adder", "wire": {"a": "a0", "b": "x0", "cin": "op", "sum": "s0", "cout": "c1"}}],
 "gates": [{"name": "g1", "type": "AND", "inputs": ["a", "b"], "output": "g1"}],
 "flipflops": [{"name": "q0", "d": "n0"}]}
```
Rules: `type` ∈ `AND OR XOR NOT NAND`; `NOT` has exactly 1 input, others exactly 2; names and outputs unique; every order output mapped to an existing signal; `part` must exist in the library; every port of an instance wired; `flipflops` only when allowed, their `name` is a usable signal. `instances` and `flipflops` may be `[]`.

## 3. Library part (engine/library.py)
```json
{"id": "full_adder", "ports": {"inputs": ["a", "b", "cin"], "outputs": ["sum", "cout"]},
 "blueprint": {"...": "a Blueprint using only gates and already-verified parts"},
 "verified": true, "gates": 5, "born_shift": 1}
```
Primitive gates are types, not parts. The library starts empty.

## 4. Inspection (engine/inspector.py → runner, investigator, stage)
```json
{"order_id": "ord_0001", "version": "v3", "attempt": 2, "pass": false,
 "correct": {"ok": false, "passed": 384, "total": 512},
 "rules": {"format": "ok", "allowed_gates": "ok", "pins": "ok", "fanout": "ok", "depth": "ok", "unused": "fail", "budget": "ok"},
 "gates": 17, "best_known_gates": 11, "depth": 6,
 "failure_category": "wrong_logic",
 "note": "carry wire into fa1 comes from b3 (should be fa0.cout)",
 "bad_wires": [["b3", "fa1.cin"]], "bad_blocks": ["fa1"],
 "metrics": {"model": "nvidia/Nemotron-3.5-Lightning-30B-A3B", "thinking": true, "tokens_in": 2100, "tokens_out": 900,
             "thinking_chars": 4200, "cached_tokens": 1800, "cost_usd": 0.004, "time_s": 9.1, "ttft_s": 0.4}}
```
- `failure_category` ∈ `format | wrong_logic | assembly | rules | budget | spiral | none` (first failing in that order).
- Default fab rules: fan-out ≤ 4 per signal; depth ≤ 12; no unused gates; every pin wired; budget = `order.gate_budget`; allowed = `order.allowed_gates`; format = schema/arity/unknown names.
- **Exam pass** = `correct.ok` AND every rule `ok` AND `attempt ≤ 3` within caps (12k tokens / 120 s per attempt).

## 5. Lesson (engine/investigator.py → library index)
```json
{"id": "L007", "when": "assembling parts with a carry chain",
 "pitfall": "carry wire into fa1 came from b3 instead of fa0.cout",
 "verification": "check every instance port against the previous part's output list before handing in",
 "category": "assembly", "born_shift": 2, "hits": 3, "active": true}
```

## 6. Snapshot = a version (engine/gate.py → snapshots/vN.json)
```json
{"version": "v3", "parent": "v2", "created": "2026-10-17T12:40:00",
 "routing": {"architect": {"model": "...Super...", "thinking": true, "max_tokens": 20000},
             "designer": {"model": "...Lightning...", "thinking": true, "max_tokens": 12000},
             "designer_novel": {"model": "...Lightning...", "thinking": true, "max_tokens": 12000},
             "assembler": {"model": "...Lightning...", "thinking": true, "max_tokens": 12000},
             "investigator": {"model": "...Lightning...", "thinking": true, "max_tokens": 6000}},
 "flags": {"schema_on": true, "no_fast_lane": true, "route_novel_to_super": false, "loop_cutter": false,
           "tidy_tool": false, "fanout_buffer_rule": false, "library_first": false, "stable_prefix": false},
 "playbook": ["L001", "L004"], "library": ["full_adder"],
 "change_log": [{"shift": 2, "proposal": "schema_on", "hypothesis": "format failures dominate (14/20)",
                 "verdict": "keep", "before": {"pass": 0.15, "cost_usd": 0.42}, "after": {"pass": 0.35, "cost_usd": 0.31}}]}
```
v1 = all Lightning, thinking on, every flag false, empty playbook and library.

## 7. ChipRun (one order, one version; the unit the stage animates)
```json
{"run_id": "run_00031", "version": "v1", "order": {"...Order without truth/best_known_gates..."}, "attempts": 2,
 "events": [
   {"t": 0.0, "type": "order"},
   {"t": 0.4, "type": "spawn", "agent": "architect", "role": "architect", "model": "...Super..."},
   {"t": 2.1, "type": "plan", "parts": ["fa0", "fa1", "fa2", "fa3"], "definition_of_done": ["all 512 inputs correct", "every pin wired"]},
   {"t": 3.0, "type": "spawn", "agent": "designer:fa0", "role": "designer", "model": "...Lightning..."},
   {"t": 5.2, "type": "place", "block": "fa0", "kind": "part", "label": "FA0"},
   {"t": 5.4, "type": "wire", "from": "fa0.cout", "to": "fa1.cin"},
   {"t": 8.0, "type": "test", "attempt": 1, "inputs": {"a": 7, "b": 5}, "expected": 12, "got": 10},
   {"t": 8.1, "type": "fail", "attempt": 1, "category": "assembly", "note": "carry wire into fa1 comes from b3", "bad_wires": [["b3", "fa1.cin"]], "bad_blocks": ["fa1"]},
   {"t": 9.0, "type": "retry", "attempt": 2},
   {"t": 14.0, "type": "pass", "attempt": 2},
   {"t": 14.1, "type": "lesson", "id": "L007", "text": "carry wire into fa1 came from b3 → check every port before handing in"},
   {"t": 14.2, "type": "done"}],
 "blueprint": {"...": "final Blueprint"}, "yosys_json": {"...": "for netlistsvg"}, "inspection": {"...": "final Inspection"}}
```
`kind` ∈ `part | gate`. Event types: `order spawn plan place wire test fail retry pass lesson spiral human_ping done`.

## 8. run.json (engine/runner.py → web/; rewritten after every event; the stage polls it every 1 s and computes nothing)
```json
{"updated": "2026-10-17T14:12:03", "status": "running", "current_version": "v3", "versions": ["v1", "v2", "v3"],
 "shifts": [{"shift": 1, "version": "v1", "practice": ["<ChipRun>"],
             "validation": {"proposal": "schema_on", "old": ["<ChipRun>"], "new": ["<ChipRun>"], "verdict": "keep",
                            "delta": {"pass": 0.20, "cost_usd": -0.11}},
             "lessons_added": ["L001"], "categories": {"format": 14, "wrong_logic": 3, "assembly": 2, "rules": 1, "budget": 0, "spiral": 0}}],
 "exam": {"v1": {"pass_rate": 0.15, "by_rung": {"1": 0.6, "2": 0.0}, "categories": {"format": 20}, "runs": ["<ChipRun>"]}},
 "live": null,
 "gauges": {"tok_s": 333, "ttft_s": 0.3, "cache_rate": 0.71, "cost_total_usd": 4.1, "chips_per_hour": 48, "human_pings": 0}}
```

## 9. HTTP (server.py, laptop B)
- `GET /run.json` → the file above. `GET /runs/{run_id}.json` → one ChipRun.
- `POST /order` `{"title": "...", "spec": "...", "version": "v8"}` → `202 {"run_id": "..."}`; the runner picks it up and the ChipRun appears in `live`. Fallback file: `samples/live_fallback.json`.
- `GET /snapshots/{version}.json`.

## 10. Yosys JSON export (engine/yosys_io.py → netlistsvg)
Our Blueprint flattened → `{"modules": {"<id>": {"ports": {...}, "cells": {"g1": {"type": "$_AND_", "port_directions": {"A": "input", "B": "input", "Y": "output"}, "connections": {"A": [2], "B": [3], "Y": [7]}}}}}}`. Nets are ints; `$_NOT_` uses A→Y; `$_DFF_P_` uses D, C, Q.
