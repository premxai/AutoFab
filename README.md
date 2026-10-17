# AutoFab

**We built the factory, not the chips.** A team of NVIDIA Nemotron agents on Crusoe Managed Inference designs small logic chips, verifies every one on every possible input, learns from its own failures, and proves the improvement on the same 40-chip exam it has never seen.

Recursive Agents Hackathon · San Francisco · Oct 17, 2026 · Track: Version N+1 (also demonstrates Done Means Done and Shared Brain).

## Status
Build in progress. See `TASKS.md` (status board), `docs/PLAN.md` (the plan), `docs/CONTRACTS.md` (data contracts), `tasks/` (briefs).

## Run
```
pip install -r requirements.txt
set CRUSOE_API_KEY=...            # or put the key in ~/.crusoe_key
uvicorn server:app --port 8000    # the stage at http://localhost:8000/
python -m engine.runner --shifts 8 --exam v1,v4,v8
```

## Honesty notes
- The exhaustive-test checker and the API harness (`tools/spike_checker.py`) were built the night before as a feasibility spike; everything else was built on Oct 17.
- Fab rules (fan-out, depth, budgets) are simplified. Every number on screen is read from `runs/run.json`, produced by real Crusoe calls.

## Built on Crusoe
Managed Inference (Nemotron 3.5 Lightning, 3 Super, 3.5 Super VL, 3 Nano) · structured outputs · thinking controls · MemoryAlloy prefix cache (`cached_tokens`) · per-model rate limits · Serverless Fine-Tuning (night shift). Details in `docs/PLAN.md` §8.
