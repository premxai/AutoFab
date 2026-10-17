# Task 6 — Crusoe client (`engine/client.py`) · Owner A (subagent) · branch `engine/client`

## What
One async function that calls Nemotron on Crusoe with structured outputs, thinking control, caps, a client-side loop-cutter, retries, per-model rate limiting, and full metrics. Verified facts in `docs/PLAN.md` §1 (read it).

## API
```python
@dataclass
class CallResult: content: str; parsed: dict|None; reasoning: str; spiral: bool; ttft_s: float|None; time_s: float; tokens_in: int; tokens_out: int; thinking_chars: int; cached_tokens: int|None; cost_usd: float; model: str; thinking: bool; error: str|None

async def call(role: str, messages: list[dict], routing: dict, *, schema: dict|None, thinking: bool|None=None,
               max_tokens: int|None=None, timeout_s: float=120, loop_cutter: bool=False, provider: str="crusoe") -> CallResult
def price(model: str) -> tuple[float,float,float]   # $/1M in, out, cached-in (Crusoe pricing table; Lightning .05/.20/.03, Super .30/2.40/.15, Super VL .10/.40/.08, Nano .05/.20/.03)
```
- Base `https://api.inference.crusoecloud.com/v1`, key from env `CRUSOE_API_KEY` or `~/.crusoe_key`; header `User-Agent: autofab/0.1`. OpenAI SDK async client is fine, or stdlib urllib; streaming required (TTFT, reasoning deltas).
- Thinking: `chat_template_kwargs: {"enable_thinking": bool}`. Never send `reasoning_budget` (403). `response_format = {"type":"json_schema","json_schema":{"name":"netlist","strict":true,"schema":schema}}` when `schema` is given (and the snapshot flag says so — the caller decides).
- Reasoning arrives as `delta.reasoning_content` (or `reasoning`); content as `delta.content`. `usage` on the final chunk with `stream_options: {"include_usage": true}`; `usage.prompt_tokens_details.cached_tokens` may be absent (Lightning) — store `None`.
- **Loop-cutter** (when `loop_cutter=True`): keep the last 4000 reasoning chars; if any 12-token n-gram occurs ≥ 6 times → abort the stream, `spiral=True`. Also `spiral=True` when the stream ends with empty content (cap hit while thinking) or on timeout.
- Rate limits: `asyncio.Semaphore` per model (default 8; env `AUTOFAB_RPM_<MODEL>` optional); on 429/503 back off 1 s doubling + jitter, cap 30 s, 5 tries; read `x-ratelimit-remaining-requests/tokens` into a module-level dict `remaining`.
- `provider`: `crusoe` default; `nebius` / `neon` read `NEBIUS_API_KEY`/`NEON_API_KEY` + base URLs from env — smoke tests only; model names mapped via a small dict; features that don't exist there are skipped with a warning.
- Log every call as one JSON line to `runs/calls.jsonl` (no prompts, just metrics).

## Acceptance
`python -m engine.client --selftest` (needs the key): Lightning "ping" returns content with ttft < 1 s; a schema call on Lightning returns `parsed` with keys inputs/outputs/gates/instances/flipflops; a deliberately long novel prompt with `loop_cutter=True`, `max_tokens=6000` returns `spiral=True` in < 60 s; cost computed; `runs/calls.jsonl` grows. Add a no-key fast path to `scripts/test.sh` that only imports the module.

## Prompt for the subagent
```
Read docs/PLAN.md §1 (verified API facts), docs/CONTRACTS.md, docs/blueprint.schema.json and tasks/client.md. Implement engine/client.py exactly to the API: async, streaming, structured outputs via response_format json_schema strict, thinking via chat_template_kwargs.enable_thinking, never reasoning_budget, client-side loop-cutter on repeated n-grams, per-model semaphores with 429/503 backoff, metrics incl. cost from the price table, calls.jsonl logging, provider switch for smoke tests. Include `--selftest`. Work only in engine/client.py and scripts/test.sh. Branch engine/client. The key is in ~/.crusoe_key; never print it. Run the selftest before reporting.
```
