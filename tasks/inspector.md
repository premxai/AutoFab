# Task 5 — Inspector (`engine/inspector.py`) · Owner A (subagent) · branch `engine/inspector`

## What
The code that never trusts the agents: flatten a Blueprint (library instances → gates), test every input (or simulate the clocked sequence), check fab rules, score, and write a plain-English note with `bad_wires`/`bad_blocks`. Port and extend the verified spike in `tools/spike_checker.py` (functions `norm`, `evaluate`, `check_comb`, `check_counter`, `flatten`, `check_assembly`).

## API
```python
def inspect(order: dict, blueprint: dict, library: dict[str, dict], version: str, attempt: int, metrics: dict) -> dict   # returns Inspection (CONTRACTS §4)
def flatten(blueprint: dict, library: dict) -> dict          # gates-only blueprint; raises FormatError(message) on unknown part/port/arity/type/duplicate names
def simulate(flat: dict, inputs: dict[str,int], state: dict|None=None) -> dict
def fab_rules(flat: dict, order: dict) -> dict                # {"fanout": "ok|fail", "depth":..., "unused":..., "pins":..., "budget":..., "allowed_gates":..., "format": "ok"}
def tidy(flat: dict) -> dict                                  # dedupe identical gates, remove double NOT, drop dead gates (used by the tidy_tool flag)
```
Rules: fan-out ≤ 4 per signal; depth ≤ 12 (order may override); no unused gates; every order output mapped and driven; budget = order.gate_budget; allowed = order.allowed_gates; `NOT` 1 input, others 2. `failure_category` = first failing in `format → wrong_logic → assembly → rules → budget` (`assembly` when an instance port/wire is wrong or a wire goes to a non-existent signal; `wrong_logic` when flat logic is simply wrong). `spiral` is set by the client/runner, not here.
Note text: for wrong wiring name the wire ("carry wire into fa2 comes from b3 (should be fa1.cout)" when a library part's input is driven by a primary input of another bit — heuristic: find the first failing instance port whose driver is not the expected previous-stage output); for wrong logic give the first failing input vector and expected vs got; for rules name the rule and the signal.

## Acceptance
`python -m engine.inspector --selftest` reproduces the spike's results: 8-gate D passes 16/16; Nemotron's 15-gate D and 17-cell E pass; 9-NAND full adder passes with NAND-only budget 9 and a 10th AND gate is rejected as `allowed_gates`; correct 2-bit counter passes and a wrong one fails; a 4-bit add/sub assembly passes 512/512, a carry mis-wire gives 256/512 with `bad_wires=[["b3","fa1.cin"]]`, an unwired port and an unknown part are `format`. Fan-out 5 on one signal → `rules.fanout = fail`. Add to `scripts/test.sh`.

## Prompt for the subagent
```
Read docs/CONTRACTS.md §2–§4 and tasks/inspector.md, and study tools/spike_checker.py (verified logic; port it, don't rewrite the algorithms). Implement engine/inspector.py to the API, with a `--selftest` that reproduces every case in the acceptance list. Stdlib only. Work only in engine/inspector.py and scripts/test.sh. Branch engine/inspector. Run the selftest before reporting.
```
