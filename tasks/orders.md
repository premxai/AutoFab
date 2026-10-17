# Task 4 — Order generator (`engine/orders.py`, `engine/yosys_io.py`) · Owner A (subagent) · branch `engine/orders`

## What
Generate orders (CONTRACTS §1) from templates with random parts, in three pools, with a Yosys/ABC `best_known_gates` per order. Deterministic by seed.

## Templates (rung → title pattern → truth/sequence)
1. Calculator: "Calculator that adds two N-bit numbers" (N ∈ 2..4), optional subtract mode bit (`op`): truth from arithmetic; inputs `aN-1..a0, bN-1..b0[, op]`, outputs `sN-1..s0, cout`.
2. Door lock: "Door lock that opens only for codes {k1, k2, ...}" (4 inputs, 3–6 random codes), output `y`.
3. Two-light lock: "Lock with a green light for codes {…} and a red light for codes {…}" (4–5 inputs, outputs `green`, `red`).
4. Constrained: any of 2/3 with `allowed_gates=["NAND"]` and `gate_budget = best_known_gates + 2`, title "… built from only NAND chips, at most B".
5. Sequential: "Traffic light that cycles green → yellow → red" (2-bit counter / 3-state FSM), `flipflops_allowed=true`, `sequence={"steps":6,"expected":[...]}`, outputs `q1,q0` (or `g,y,r`).
6. Misc: "Majority vote of 3 judges", "Digit display segment {s} for digit {d}" (7-seg segment of a 4-bit digit), "Even-parity detector for 4 bits".

## API
```python
def make_orders(pool: str, n: int, seed: int, rungs: list[int] | None = None) -> list[dict]
def exam_orders(seed: int) -> list[dict]        # 40 orders, rung mix 1:8, 2:10, 3:6, 4:8, 5:4, 6:4, saved to orders/exam_seed.json
def agent_view(order: dict) -> dict             # strips truth/best_known_gates; keeps title, spec, inputs, outputs, allowed_gates, gate_budget, flipflops_allowed
```
`engine/yosys_io.py`: `best_known_gates(order) -> int|None` via `yowasp-yosys` (BLIF `.names` from truth → `read_blif; synth -top o; abc -g AND,NAND,OR,NOR,XOR,XNOR; opt_clean; stat`; NAND rung `abc -g NAND`, count NOT as 1); use cwd-relative temp paths (WASI can't open 8.3 paths); cache by truth hash in `orders/yosys_cache.json`; return `None` on failure. Also `to_yosys_json(flat_blueprint) -> dict` (CONTRACTS §10) for netlistsvg.

## Acceptance
`python -m engine.orders --selftest`: generates 10 orders per rung with seed 1, every truth covers all 2^n inputs, titles unique, `exam_orders(42)` returns 40 with the rung mix, `agent_view` has no `truth`; Yosys baseline runs for a 4-input lock in < 3 s (after the first WASM compile) and returns 5. Add these checks to `scripts/test.sh`.

## Prompt for the subagent
```
Read docs/CONTRACTS.md §1 and §10 and tasks/orders.md. Implement engine/orders.py and engine/yosys_io.py exactly to the spec and API. Python 3.13, stdlib + yowasp-yosys only. Deterministic by seed. Include `python -m engine.orders --selftest`. Work only in engine/orders.py, engine/yosys_io.py, scripts/test.sh. Branch engine/orders. Run the selftest and scripts/test.sh before reporting.
```
