"""AutoFab model client: Nemotron on Crusoe (and smoke-test providers), stdlib only.

    from engine.client import call, price, remaining, CallResult
    r = await call("architect", messages, routing, schema=None)

Features: streaming (TTFT + reasoning deltas), strict json_schema structured outputs,
thinking via chat_template_kwargs.enable_thinking (never reasoning_budget: Crusoe 403s it),
client-side loop-cutter, per-model semaphores with 429/503 backoff, cost from the price
table, one metrics-only JSON line per call in runs/calls.jsonl.

TTFT = seconds from request start to the first streamed token of ANY kind (reasoning or content).

    python -m engine.client --selftest      # real API, costs a few cents, needs the key
The API key is never printed, logged or put in an error message.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any

CRUSOE_BASE = "https://api.inference.crusoecloud.com/v1"
USER_AGENT = "autofab/0.1"

LIGHTNING = "nvidia/Nemotron-3.5-Lightning-30B-A3B"
SUPER = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B"
SUPER_VL = "nvidia/NVIDIA-Nemotron-3.5-Super-VL"
NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
NANO_OMNI = "nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B"

# $/1M tokens: (input, output, cached input)  -- Crusoe pricing table
PRICES: dict[str, tuple[float, float, float]] = {
    LIGHTNING: (0.05, 0.20, 0.03),
    SUPER: (0.30, 2.40, 0.15),
    SUPER_VL: (0.10, 0.40, 0.08),
    NANO: (0.05, 0.20, 0.03),
    NANO_OMNI: (0.05, 0.20, 0.03),  # no published price in the plan; assumed = Nano
}

# Smoke-test providers: base URL + key from env; model names mapped (override via env if wrong).
# Defaults are best guesses and unverified; override with <PROVIDER>_BASE_URL / AUTOFAB_<PROVIDER>_MODEL_<n>.
PROVIDERS: dict[str, dict[str, Any]] = {
    "crusoe": {"key_env": "CRUSOE_API_KEY", "base": CRUSOE_BASE, "base_env": None, "models": {}},
    "nebius": {"key_env": "NEBIUS_API_KEY", "base": "https://api.tokenfactory.nebius.com/v1",
               "base_env": "NEBIUS_BASE_URL",
               "models": {SUPER: "nvidia/nemotron-3-super-120b-a12b", LIGHTNING: "nvidia/nemotron-3-super-120b-a12b"}},
    "neon": {"key_env": "NEON_API_KEY", "base": None, "base_env": "NEON_BASE_URL",
             "models": {}},
}

RUNS_DIR = os.environ.get("AUTOFAB_RUNS_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "runs")
CALLS_LOG = os.path.join(RUNS_DIR, "calls.jsonl")

# latest x-ratelimit-remaining-* header values, keyed "<model>" -> {"requests": n, "tokens": n}
remaining: dict[str, dict[str, int]] = {}

_log_lock = threading.Lock()
_sems: dict[tuple[int, str], asyncio.Semaphore] = {}
_warned: set[str] = set()


@dataclass
class CallResult:
    content: str
    parsed: dict | None
    reasoning: str
    spiral: bool
    ttft_s: float | None
    time_s: float
    tokens_in: int
    tokens_out: int
    thinking_chars: int
    cached_tokens: int | None
    cost_usd: float
    model: str
    thinking: bool
    error: str | None


def price(model: str) -> tuple[float, float, float]:
    """($/1M in, $/1M out, $/1M cached-in) for a model id (unknown -> Nano rates)."""
    return PRICES.get(model, PRICES[NANO])


def _warn(msg: str) -> None:
    if msg not in _warned:
        _warned.add(msg)
        print("[autofab.client] WARNING:", msg, file=sys.stderr)


def _api_key(provider: str) -> str:
    cfg = PROVIDERS[provider]
    k = os.environ.get(cfg["key_env"], "").strip()
    if not k and provider == "crusoe":
        p = os.path.join(os.path.expanduser("~"), ".crusoe_key")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                k = f.read().strip()
    if not k:
        raise RuntimeError(f"no API key for provider {provider}: set {cfg['key_env']}"
                           + (" or create ~/.crusoe_key" if provider == "crusoe" else ""))
    return k


def _base_url(provider: str) -> str:
    cfg = PROVIDERS[provider]
    b = (os.environ.get(cfg["base_env"]) if cfg["base_env"] else None) or cfg["base"]
    if not b:
        raise RuntimeError(f"no base URL for provider {provider}: set {cfg['base_env']}")
    return b.rstrip("/")


def _sem(model: str) -> asyncio.Semaphore:
    loop_id = id(asyncio.get_running_loop())
    k = (loop_id, model)
    if k not in _sems:
        tag = re.sub(r"[^A-Za-z0-9]+", "_", model.split("/")[-1]).upper().strip("_")
        n = 8
        for env in (f"AUTOFAB_RPM_{tag}", "AUTOFAB_RPM"):
            if os.environ.get(env, "").isdigit():
                n = max(1, int(os.environ[env]))
                break
        _sems[k] = asyncio.Semaphore(n)
    return _sems[k]


# ---------------------------------------------------------------- loop-cutter
_TOK = re.compile(r"\S+")


def find_loop(reasoning: str, window: int = 4000, n: int = 12, times: int = 6) -> bool:
    """True if any n-token n-gram occurs >= `times` times in the last `window` chars."""
    toks = _TOK.findall(reasoning[-window:])
    if len(toks) < n * 2:
        return False
    grams = Counter(tuple(toks[i:i + n]) for i in range(len(toks) - n + 1))
    return grams.most_common(1)[0][1] >= times


# ---------------------------------------------------------------- blocking HTTP stream (runs in a thread)
class _Http(Exception):
    def __init__(self, status: int, body: str, retry_after: float | None):
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status, self.body, self.retry_after = status, body, retry_after


def _note_limits(model: str, headers) -> None:
    out = {}
    for name, key in (("x-ratelimit-remaining-requests", "requests"), ("x-ratelimit-remaining-tokens", "tokens")):
        v = headers.get(name)
        if v is not None:
            try:
                out[key] = int(float(v))
            except ValueError:
                pass
    if out:
        remaining.setdefault(model, {}).update(out)


def _stream_once(base: str, key: str, body: dict, model: str, deadline: float,
                 loop_cutter: bool, cancel: threading.Event) -> dict:
    """One streaming request. Returns dict(content, reasoning, usage, ttft, spiral, reason, finish)."""
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(), method="POST")
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream, application/json")
    t0 = time.monotonic()
    st = {"content": "", "reasoning": "", "usage": None, "ttft": None, "spiral": False, "reason": None, "finish": None}
    try:
        resp = urllib.request.urlopen(req, timeout=max(5.0, min(60.0, deadline - t0)))
    except urllib.error.HTTPError as e:
        _note_limits(model, e.headers)
        ra = e.headers.get("retry-after")
        try:
            ra_f = float(ra) if ra else None
        except ValueError:
            ra_f = None
        raise _Http(e.code, e.read().decode("utf-8", "replace"), ra_f) from None
    _note_limits(model, resp.headers)
    last_check = 0
    try:
        for raw in resp:
            if cancel.is_set():
                st["reason"] = "cancelled"
                break
            if time.monotonic() > deadline:
                st["spiral"], st["reason"] = True, "timeout"
                break
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                ch = json.loads(payload)
            except ValueError:
                continue
            if ch.get("usage"):
                st["usage"] = ch["usage"]
            for c in ch.get("choices") or []:
                d = c.get("delta") or {}
                r = d.get("reasoning_content") or d.get("reasoning") or ""
                t = d.get("content") or ""
                if (r or t) and st["ttft"] is None:
                    st["ttft"] = time.monotonic() - t0
                st["reasoning"] += r
                st["content"] += t
                if c.get("finish_reason"):
                    st["finish"] = c["finish_reason"]
            if loop_cutter and not st["content"] and len(st["reasoning"]) - last_check >= 200:
                last_check = len(st["reasoning"])
                if find_loop(st["reasoning"]):
                    st["spiral"], st["reason"] = True, "loop_cutter"
                    break
    finally:
        try:
            resp.close()
        except Exception:
            pass
    return st


# ---------------------------------------------------------------- logging
def _log(rec: dict) -> None:
    try:
        os.makedirs(RUNS_DIR, exist_ok=True)
        with _log_lock, open(CALLS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
    except OSError as e:  # logging must never break a call
        _warn(f"could not write calls.jsonl: {e}")


def _parse_json(text: str) -> dict | None:
    t = text.strip()
    for cand in (t, t[t.find("{"):t.rfind("}") + 1] if "{" in t and "}" in t else ""):
        if not cand:
            continue
        try:
            v = json.loads(cand)
            return v if isinstance(v, dict) else None
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------- public API
async def call(role: str, messages: list[dict], routing: dict, *, schema: dict | None = None,
               thinking: bool | None = None, max_tokens: int | None = None, timeout_s: float = 120,
               loop_cutter: bool = False, provider: str = "crusoe") -> CallResult:
    """Call the model routed for `role` (routing[role] = {model, thinking, max_tokens}; a flat
    {model,...} dict is also accepted). Never raises on API errors: see CallResult.error."""
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider {provider!r}")
    cfg = routing.get(role) if isinstance(routing.get(role), dict) else routing
    model = cfg.get("model") or LIGHTNING
    if thinking is None:
        thinking = bool(cfg.get("thinking", True))
    if max_tokens is None:
        max_tokens = int(cfg.get("max_tokens") or 4096)
    wire_model = PROVIDERS[provider]["models"].get(model, model)
    if provider != "crusoe":
        env_model = os.environ.get("AUTOFAB_%s_MODEL_%s" % (provider.upper(), re.sub(r"\W+", "_", model.split("/")[-1]).upper()))
        wire_model = env_model or wire_model

    body: dict[str, Any] = {
        "model": wire_model, "messages": messages, "max_tokens": max_tokens,
        "temperature": 1.0, "top_p": 0.95,
        "stream": True, "stream_options": {"include_usage": True},
    }
    if provider == "crusoe" or os.environ.get(f"AUTOFAB_{provider.upper()}_THINKING_KWARGS") == "1":
        body["chat_template_kwargs"] = {"enable_thinking": bool(thinking)}
    else:
        _warn(f"provider {provider}: chat_template_kwargs (thinking control) skipped")
    if schema is not None:
        body["response_format"] = {"type": "json_schema",
                                   "json_schema": {"name": "netlist", "strict": True, "schema": schema}}

    t_start = time.monotonic()
    deadline = t_start + timeout_s
    error: str | None = None
    st: dict | None = None
    cancel = threading.Event()
    try:
        base, key = _base_url(provider), _api_key(provider)
    except RuntimeError as e:
        base = key = ""
        error = str(e)

    delay = 1.0
    for attempt in range(5 if not error else 0):
        if time.monotonic() >= deadline:
            error = "timeout"
            break
        try:
            async with _sem(model):
                st = await asyncio.to_thread(_stream_once, base, key, body, model, deadline, loop_cutter, cancel)
            error = None
            break
        except _Http as e:
            if e.status in (429, 503):
                error = f"HTTP {e.status} after {attempt + 1} tries"
                if attempt == 4:
                    break
                wait = min(30.0, max(delay, e.retry_after or 0.0)) + random.uniform(0, 0.5 * delay)
                delay = min(30.0, delay * 2)
                if time.monotonic() + wait >= deadline:
                    break
                await asyncio.sleep(wait)
                continue
            error = str(e)
            break
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            # transient network trouble: count as a try, same backoff
            error = f"network: {type(e).__name__}: {str(e)[:120]}"
            if attempt == 4:
                break
            await asyncio.sleep(min(30.0, delay) + random.uniform(0, 0.5 * delay))
            delay = min(30.0, delay * 2)
        except asyncio.CancelledError:
            cancel.set()
            raise
    st = st if st is not None else {"content": "", "reasoning": "", "usage": None, "ttft": None,
                                    "spiral": False, "reason": None, "finish": None}
    time_s = time.monotonic() - t_start
    content, reasoning, usage = st["content"], st["reasoning"], st["usage"] or {}

    spiral = bool(st["spiral"])
    spiral_reason = st["reason"] if spiral else None
    if error is None and not content.strip() and not spiral:
        spiral, spiral_reason = True, ("cap_while_thinking" if st["finish"] == "length" else "empty_content")
    if error == "timeout" and not spiral:
        spiral, spiral_reason = True, "timeout"

    est_out = int((len(content) + len(reasoning)) / 4)
    tokens_in = int(usage.get("prompt_tokens") or sum(len(str(m.get("content", ""))) for m in messages) // 4)
    tokens_out = int(usage.get("completion_tokens") or est_out)
    cached = ((usage.get("prompt_tokens_details") or {}).get("cached_tokens")) if usage else None
    p_in, p_out, p_cached = price(model)
    c = cached or 0
    cost = ((tokens_in - c) * p_in + c * p_cached + tokens_out * p_out) / 1e6

    parsed = _parse_json(content) if (schema is not None and content) else None
    res = CallResult(content=content, parsed=parsed, reasoning=reasoning, spiral=spiral, ttft_s=st["ttft"],
                     time_s=time_s, tokens_in=tokens_in, tokens_out=tokens_out, thinking_chars=len(reasoning),
                     cached_tokens=cached, cost_usd=cost, model=model, thinking=bool(thinking), error=error)
    _log({"ts": round(time.time(), 3), "role": role, "provider": provider, "model": model,
          "thinking": bool(thinking), "schema": schema is not None, "loop_cutter": loop_cutter,
          "max_tokens": max_tokens, "ttft_s": res.ttft_s and round(res.ttft_s, 3), "time_s": round(time_s, 3),
          "tokens_in": tokens_in, "tokens_out": tokens_out, "thinking_chars": len(reasoning),
          "content_chars": len(content), "cached_tokens": cached, "cost_usd": round(cost, 6),
          "spiral": spiral, "spiral_reason": spiral_reason, "parsed_ok": parsed is not None if schema else None,
          "error": error, "remaining": remaining.get(model)})
    return res


# ---------------------------------------------------------------- selftest
def _count_lines() -> int:
    try:
        with open(CALLS_LOG, encoding="utf-8") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _fake_server():
    """Local SSE server: /loop/ streams endlessly repeating reasoning; /retry/ 429s twice then answers."""
    import http.server

    state = {"n": 0}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers.get("content-length") or 0))
            if self.path.startswith("/retry/") and state["n"] < 2:
                state["n"] += 1
                self.send_response(429)
                self.send_header("retry-after", "0.1")
                self.send_header("x-ratelimit-remaining-requests", "7")
                self.end_headers()
                self.wfile.write(b'{"error":"slow down"}')
                return
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("x-ratelimit-remaining-tokens", "1234")
            self.end_headers()
            try:
                if self.path.startswith("/loop/"):
                    for _ in range(2000):
                        d = {"choices": [{"delta": {"reasoning_content":
                                                    "Let me check the truth table again and again for this row. " * 3}}]}
                        self.wfile.write(("data: %s\n\n" % json.dumps(d)).encode())
                        self.wfile.flush()
                        time.sleep(0.005)
                else:
                    for d in ({"choices": [{"delta": {"content": "ok"}}]},
                              {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 1}}):
                        self.wfile.write(("data: %s\n\n" % json.dumps(d)).encode())
                    self.wfile.write(b"data: [DONE]\n\n")
            except OSError:
                pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def _selftest() -> int:
    ok = True

    def check(name: str, cond: bool, detail: str) -> None:
        nonlocal ok
        ok = ok and cond
        print(("PASS " if cond else "FAIL ") + name + " | " + detail)

    routing = {"r": {"model": LIGHTNING, "thinking": False, "max_tokens": 300}}
    lines0 = _count_lines()
    total_cost = 0.0

    # 1. ping, thinking off
    r = await call("r", [{"role": "user", "content": "Reply with the single word: pong"}], routing,
                   schema=None, thinking=False, max_tokens=50, timeout_s=30)
    total_cost += r.cost_usd
    toks = r.tokens_out / r.time_s if r.time_s else 0
    check("ping", bool(r.content.strip()) and r.error is None and r.ttft_s is not None and r.ttft_s < 1.0,
          f"content={r.content.strip()[:30]!r} ttft={r.ttft_s and round(r.ttft_s, 3)}s total={r.time_s:.2f}s "
          f"tok/s={toks:.0f} in={r.tokens_in} out={r.tokens_out} cached={r.cached_tokens} err={r.error}")

    # 2. strict schema call
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(here, "docs", "blueprint.schema.json"), encoding="utf-8") as f:
        schema = json.load(f)
    msg = [{"role": "user", "content": "Design a circuit with inputs a and b and output y = a XOR b, "
                                       "built from a single XOR gate. Use no instances and no flipflops."}]
    r = await call("r", msg, routing, schema=schema, thinking=False, max_tokens=800, timeout_s=60)
    total_cost += r.cost_usd
    keys = {"inputs", "outputs", "gates", "instances", "flipflops"}
    check("schema", r.parsed is not None and keys <= set(r.parsed),
          f"keys={sorted(r.parsed) if r.parsed else None} ttft={r.ttft_s and round(r.ttft_s, 3)}s "
          f"total={r.time_s:.2f}s cost=${r.cost_usd:.6f} err={r.error}")

    # 3. loop-cutter / spiral on a novel 4-input function (thinking on, JSON only described in prose)
    prompt = ("Design a combinational circuit with inputs a,b,c,d and one output y using only 2-input AND, OR, XOR "
              "gates and 1-input NOT gates. Truth table (abcd -> y): 0000:1 0001:0 0010:0 0011:1 0100:1 0101:1 "
              "0110:0 0111:0 1000:0 1001:1 1010:1 1011:0 1100:0 1101:0 1110:1 1111:1. Use as few gates as you can. "
              'Answer as JSON: {"inputs":[...],"outputs":{"y":"signal"},"gates":[{"name":..,"type":..,"inputs":[..],"output":..}]}.')
    cut = None
    for _ in range(2):
        r = await call("r", [{"role": "user", "content": prompt}], routing, schema=None, thinking=True,
                       max_tokens=6000, timeout_s=55, loop_cutter=True)
        total_cost += r.cost_usd
        cut = r
        if r.spiral:
            break
    assert cut is not None
    last = _tail_reason()
    check("spiral", cut.spiral and cut.time_s < 60,
          f"spiral={cut.spiral} reason={last} after={cut.time_s:.1f}s thinking_chars={cut.thinking_chars} "
          f"out_tokens={cut.tokens_out} tok/s={cut.tokens_out / cut.time_s if cut.time_s else 0:.0f} content_chars={len(cut.content)}")

    # 4. offline path checks against a local fake server (deterministic): loop-cutter abort + 429 backoff
    srv = _fake_server()
    port = srv.server_address[1]
    os.environ["NEON_API_KEY"] = "dummy"
    t = time.monotonic()
    os.environ["NEON_BASE_URL"] = f"http://127.0.0.1:{port}/loop/v1"
    lr = await call("r", [{"role": "user", "content": "x"}], routing, schema=None, thinking=True, max_tokens=999,
                    timeout_s=30, loop_cutter=True, provider="neon")
    check("loop_cutter", lr.spiral and _tail_reason() == "loop_cutter" and lr.thinking_chars < 6000,
          f"fired after {time.monotonic() - t:.2f}s / {lr.thinking_chars} reasoning chars (fake endless-repeat stream)")
    os.environ["NEON_BASE_URL"] = f"http://127.0.0.1:{port}/retry/v1"
    t = time.monotonic()
    rr = await call("r", [{"role": "user", "content": "x"}], routing, schema=None, thinking=False, provider="neon")
    check("backoff", rr.content == "ok" and rr.error is None and time.monotonic() - t >= 2.9,
          f"429,429 then ok after {time.monotonic() - t:.1f}s; remaining={remaining.get(LIGHTNING)}")
    srv.shutdown()

    # 5. unit checks: loop detector, cost, price, log growth
    check("find_loop", find_loop(("we try this again and again and again " * 400)) and not find_loop(
        " ".join(f"w{i}" for i in range(2000))), "detector true on repeats, false on distinct text")
    p = price(SUPER)
    check("price", p == (0.30, 2.40, 0.15) and price(LIGHTNING) == (0.05, 0.20, 0.03), f"super={p}")
    check("cost", total_cost > 0, f"selftest total=${total_cost:.5f}")
    grew = _count_lines() - lines0
    check("calls.jsonl", grew >= 5, f"+{grew} lines at {CALLS_LOG}")
    print("remaining (rate-limit headers):", remaining or "none reported")
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def _tail_reason() -> str | None:
    try:
        with open(CALLS_LOG, encoding="utf-8") as f:
            return json.loads(f.readlines()[-1]).get("spiral_reason")
    except (OSError, ValueError, IndexError):
        return None


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(asyncio.run(_selftest()))
    print(__doc__)
