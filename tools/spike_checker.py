"""Tonight's Crusoe/Nemotron tests. Stdlib only. Never prints the API key.

  python -I crusoe_tests.py models                 # list Nemotron ids + features
  python -I crusoe_tests.py probe [model_id ...]   # run prompts D,E,F,G,H and CHECK the answers
  python -I crusoe_tests.py finetune               # tiny fine-tune job on Lightning, timed (cheap)
  python -I crusoe_tests.py deploy --yes           # deploy the tuned model (BILLS GPU-HOURS) - only with --yes

Key: env CRUSOE_API_KEY, or a one-line file .crusoe_key next to this script.
"""
import json, os, sys, time, itertools, functools, urllib.request, urllib.error, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
INF = "https://api.inference.crusoecloud.com/v1"
FT = "https://api.intelligence.crusoecloud.com/v1"
DEFAULT_MODELS = ["nvidia/Nemotron-3.5-Lightning-30B-A3B", "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B"]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) lights-out-tests/0.1"

def key():
    k = os.environ.get("CRUSOE_API_KEY") or ""
    p = os.path.join(HERE, ".crusoe_key")
    if not k and os.path.exists(p):
        k = open(p, encoding="utf-8").read().strip()
    if not k:
        sys.exit("No key: set CRUSOE_API_KEY or create .crusoe_key (one line).")
    return k

def http(base, path, body=None, method=None, raw=None, ctype="application/json", stream=False):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Authorization", "Bearer " + key())
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json, text/event-stream")
    if data is not None: req.add_header("Content-Type", ctype)
    try:
        r = urllib.request.urlopen(req, timeout=600)
        return r if stream else json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:600]); raise

# ---------------- chat with timing ----------------
def chat(model, prompt, thinking=True, max_tokens=30000):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens,
            "temperature": 1.0, "top_p": 0.95, "stream": True, "stream_options": {"include_usage": True},
            "chat_template_kwargs": {"enable_thinking": bool(thinking)}}
    t0 = time.time(); ttft = None; content = ""; reasoning = ""; usage = None
    r = http(INF, "/chat/completions", body, stream=True)
    for line in r:
        line = line.decode().strip()
        if not line.startswith("data:"): continue
        if line == "data: [DONE]": break
        ch = json.loads(line[5:])
        if ch.get("usage"): usage = ch["usage"]
        for c in ch.get("choices", []):
            d = c.get("delta", {})
            if d.get("content"):
                if ttft is None: ttft = time.time() - t0
                content += d["content"]
            reasoning += d.get("reasoning_content") or d.get("reasoning") or ""
    dt = time.time() - t0
    ct = (usage or {}).get("completion_tokens") or int((len(content) + len(reasoning)) / 4)
    return {"content": content, "reasoning_chars": len(reasoning), "ttft": ttft, "total_s": dt,
            "completion_tokens": ct, "tok_s": ct / dt if dt else 0, "usage": usage}

# ---------------- netlist checker ----------------
OPS = {"AND": lambda a, b: a & b, "OR": lambda a, b: a | b, "XOR": lambda a, b: a ^ b, "NAND": lambda a, b: 1 - (a & b),
       "NOR": lambda a, b: 1 - (a | b), "XNOR": lambda a, b: 1 - (a ^ b), "NOT": lambda a, b=None: 1 - a}

def parse_json(text):
    s = text.find("{"); e = text.rfind("}")
    return json.loads(text[s:e + 1])

def norm(net):
    gates = net.get("gates") or net.get("cells") or []
    g = []
    for x in gates:
        typ = (x.get("type") or x.get("op") or "").upper()
        ins = x.get("inputs") or x.get("ins") or [v for k, v in x.items() if k in ("input", "input1", "input2", "in1", "in2")]
        if isinstance(ins, str): ins = [ins]
        out = x.get("output") or x.get("out") or x.get("name")
        g.append((typ, list(ins), out))
    ffs = [(f.get("name") or f.get("q") or f.get("output"), f.get("d") or f.get("input")) for f in (net.get("flipflops") or [])]
    outs = net.get("outputs") or net.get("output")
    if isinstance(outs, str): outs = {outs: outs}
    if isinstance(outs, list): outs = {o: o for o in outs}
    return g, ffs, outs or {}

def evaluate(g, sig, state=None):
    sig = dict(sig); sig.update(state or {})
    for _ in range(len(g) + 2):
        prog = False
        for typ, ins, out in g:
            if out in sig or any(i not in sig for i in ins) or typ not in OPS: continue
            vals = [sig[i] for i in ins]
            sig[out] = OPS["NOT"](vals[0]) if typ == "NOT" else functools.reduce(OPS[typ], vals)
            prog = True
        if not prog: break
    return sig

def check_comb(net, inputs, truth, allowed=None, budget=None):
    """truth(dict of input bits) -> dict of expected outputs. Returns (ok, msg)."""
    g, _, outs = norm(net)
    bad_types = [t for t, _, _ in g if allowed and t not in allowed]
    if bad_types: return False, f"disallowed gate types {set(bad_types)}"
    arity = [(o, len(i)) for t, i, o in g if (t == "NOT" and len(i) != 1) or (t != "NOT" and len(i) != 2)]
    if arity: return False, f"format failure: wrong input count on {arity[:3]} (2-input gates only)"
    unknown = [t for t, _, _ in g if t not in OPS]
    if unknown: return False, f"format failure: unknown gate types {set(unknown)}"
    wrong = 0; total = 0
    for bits in itertools.product([0, 1], repeat=len(inputs)):
        sig = evaluate(g, dict(zip(inputs, bits)))
        exp = truth(dict(zip(inputs, bits)))
        total += 1
        for o, e in exp.items():
            s = outs.get(o, o)
            if sig.get(s) != e: wrong += 1; break
    msg = f"{total - wrong}/{total} inputs correct, {len(g)} gates"
    if budget and len(g) > budget: msg += f" (over budget {budget})"
    return wrong == 0 and (not budget or len(g) <= budget), msg

def check_counter(net):
    g, ffs, outs = norm(net)
    if len(ffs) < 2: return False, f"need 2 flip-flops, got {len(ffs)}"
    state = {q: 0 for q, _ in ffs}
    seq = []
    for _ in range(4):
        sig = evaluate(g, {}, state)
        q1 = sig.get(outs.get("q1", "q1")); q0 = sig.get(outs.get("q0", "q0"))
        seq.append((q1, q0))
        state = {q: sig.get(d, 0) for q, d in ffs}
    ok = seq == [(0, 0), (0, 1), (1, 0), (1, 1)]
    return ok, f"sequence {seq} ({len(g)} gates, {len(ffs)} DFFs)"

# ---------------- hierarchical assembly (library parts -> flat gates) ----------------
LIB = {  # part -> (inputs, outputs, internal gates)
    "xor2": (["a", "b"], ["y"], [("XOR", ["a", "b"], "y")]),
    "mux2": (["a", "b", "sel"], ["y"], [("NOT", ["sel"], "ns"), ("AND", ["a", "ns"], "t1"), ("AND", ["b", "sel"], "t2"), ("OR", ["t1", "t2"], "y")]),
    "full_adder": (["a", "b", "cin"], ["sum", "cout"], [("XOR", ["a", "b"], "x1"), ("XOR", ["x1", "cin"], "sum"), ("AND", ["a", "b"], "a1"), ("AND", ["x1", "cin"], "a2"), ("OR", ["a1", "a2"], "cout")]),
}
LIB_TEXT = json.dumps({p: {"inputs": i, "outputs": o} for p, (i, o, _) in LIB.items()})

def flatten(net):
    """Expand library instances into flat gates. Raises ValueError on unknown parts/ports (a format failure)."""
    flat = [{"type": t, "inputs": i, "output": o} for t, i, o in [norm({"gates": net.get("gates") or []})[0][k] for k in range(len(net.get("gates") or []))]]
    for inst in net.get("instances") or []:
        part = inst.get("part"); wire = inst.get("wire") or inst.get("connections") or {}
        if part not in LIB: raise ValueError(f"unknown part '{part}'")
        ins, outs, gates = LIB[part]
        missing = [p for p in ins + outs if p not in wire]
        if missing: raise ValueError(f"{inst.get('name')}: ports not wired {missing}")
        pre = (inst.get("name") or part) + "."
        ren = lambda s: wire[s] if s in wire else pre + s
        for t, gi, go in gates: flat.append({"type": t, "inputs": [ren(x) for x in gi], "output": ren(go)})
    return {"gates": flat, "outputs": net.get("outputs")}

def check_assembly(net):
    try: flat = flatten(net)
    except ValueError as e: return False, f"format failure: {e}"
    ins = ["a3", "a2", "a1", "a0", "b3", "b2", "b1", "b0", "op"]
    def truth(v):
        a = v["a3"] * 8 + v["a2"] * 4 + v["a1"] * 2 + v["a0"]; b = v["b3"] * 8 + v["b2"] * 4 + v["b1"] * 2 + v["b0"]
        r = a + b if v["op"] == 0 else a + (15 - b) + 1
        return {"s3": (r >> 3) & 1, "s2": (r >> 2) & 1, "s1": (r >> 1) & 1, "s0": r & 1, "cout": (r >> 4) & 1}
    return check_comb(flat, ins, truth)

FMT = ' Reply only as JSON: {"inputs":[...],"outputs":{"<name>":"<signal>"},"gates":[{"name":"g1","type":"AND","inputs":["a","b"],"output":"g1"}]}'
PROMPTS = {
 "D": ("Using only 2-input AND, OR, XOR gates and NOT, design a circuit with inputs a,b,c,d (a = highest bit) where output y = 1 only for input values 0,2,3,7,8,9,13,14 and 0 otherwise. Use as few gates as you can." + FMT,
       lambda net: check_comb(net, ["a", "b", "c", "d"], lambda v: {"y": int((v["a"] * 8 + v["b"] * 4 + v["c"] * 2 + v["d"]) in (0, 2, 3, 7, 8, 9, 13, 14))})),
 "E": ("Design a 2-bit magnitude comparator: inputs a1,a0,b1,b0; outputs gt (a>b), eq (a=b), lt (a<b). Gates: 2-input AND, OR, XOR and NOT. Use as few gates as you can." + FMT,
       lambda net: check_comb(net, ["a1", "a0", "b1", "b0"], lambda v: (lambda A, B: {"gt": int(A > B), "eq": int(A == B), "lt": int(A < B)})(v["a1"] * 2 + v["a0"], v["b1"] * 2 + v["b0"]))),
 "G": ("Design a circuit with inputs a,b,c,d (a = highest bit) and two outputs p and q. p = 1 only for input values 1,4,6,11,12. q = 1 only for input values 0,3,5,6,9,14. Gates: 2-input AND, OR, XOR and NOT. Use as few gates as you can." + FMT,
       lambda net: check_comb(net, ["a", "b", "c", "d"], lambda v: (lambda n: {"p": int(n in (1, 4, 6, 11, 12)), "q": int(n in (0, 3, 5, 6, 9, 14))})(v["a"] * 8 + v["b"] * 4 + v["c"] * 2 + v["d"]))),
 "H": ("Using ONLY 2-input NAND gates, design a full adder (inputs a,b,cin; outputs sum,cout) in at most 9 NAND gates." + FMT,
       lambda net: check_comb(net, ["a", "b", "cin"], lambda v: {"sum": v["a"] ^ v["b"] ^ v["cin"], "cout": (v["a"] & v["b"]) | (v["cin"] & (v["a"] ^ v["b"]))}, allowed={"NAND"}, budget=9)),
 "F": ('Design a 2-bit up counter using D flip-flops and 2-input AND, OR, XOR, NOT gates. Outputs q1 q0 count 00,01,10,11,00 on each clock. Reply only as JSON: {"outputs":{"q1":"<signal>","q0":"<signal>"},"flipflops":[{"name":"q0","d":"<signal feeding D>"},{"name":"q1","d":"<signal>"}],"gates":[{"name":"g1","type":"XOR","inputs":["q0","q1"],"output":"g1"}]} where flip-flop outputs are usable as signals q0,q1.',
       check_counter),
 "I": ("You are assembling a chip from a library of PROVEN parts. Library (part -> ports): " + LIB_TEXT +
       ' Build a 4-bit ADD/SUBTRACT unit: inputs a3,a2,a1,a0 (a3 = highest), b3..b0, op. If op=0 output s = a+b; if op=1 output s = a-b (two\'s complement: a + NOT b + 1). Outputs s3,s2,s1,s0 and cout (the carry out of the top adder). You may use library instances and plain 2-input gates (AND, OR, XOR, NOT). Wire every port of every instance.'
       ' Reply only as JSON: {"outputs":{"s3":"<net>","s2":"<net>","s1":"<net>","s0":"<net>","cout":"<net>"},"instances":[{"name":"fa0","part":"full_adder","wire":{"a":"a0","b":"<net>","cin":"<net>","sum":"<net>","cout":"<net>"}}],"gates":[{"name":"g1","type":"XOR","inputs":["b0","op"],"output":"g1"}]}',
       check_assembly),
}

def probe(models):
    for m in models:
        print(f"\n=== {m} ===")
        for k, (prompt, checker) in PROMPTS.items():
            for thinking in (True, False) if k in ("D", "G") else (True,):
                try:
                    r = chat(m, prompt, thinking)
                    if not r["content"].strip(): ok, msg = False, "no final answer: hit the token cap while thinking"
                    else:
                        try: ok, msg = checker(parse_json(r["content"]))
                        except Exception as e: ok, msg = False, f"unparseable ({type(e).__name__}: {str(e)[:60]})"
                    print(f"{k} think={'on ' if thinking else 'off'} | {'PASS' if ok else 'FAIL'} | {msg} | ttft {r['ttft'] and round(r['ttft'],2)}s total {r['total_s']:.1f}s | {r['completion_tokens']} tok ({r['tok_s']:.0f} tok/s) | thinking {r['reasoning_chars']} chars")
                except Exception as e:
                    print(f"{k} think={thinking} | ERROR {type(e).__name__}: {str(e)[:120]}")
                time.sleep(1)

def models():
    d = http(INF, "/models")
    for m in d["data"]:
        if "nemotron" in m["id"].lower():
            print(m["id"], "|", m.get("context_length"), "|", m.get("architecture", {}).get("modality"), "| features", m.get("features"), "| params", m.get("supported_parameters"))
    print("\n--- fine-tune endpoint models ---")
    try:
        for m in http(FT, "/models")["data"]:
            if "nemotron" in json.dumps(m).lower(): print(m.get("id"), {k: v for k, v in m.items() if k != "id" and not isinstance(v, (dict, list))})
    except Exception as e: print("fine-tune model list failed:", e)

# ---------------- fine-tune timing (cheap) ----------------
def finetune():
    rows = []
    for a, b, c in itertools.product([0, 1], repeat=3):
        rows.append({"messages": [{"role": "system", "content": "You design verified gate netlists as JSON."},
                                   {"role": "user", "content": f"Full adder with a={a}, b={b}, cin={c}: give sum and cout."},
                                   {"role": "assistant", "content": json.dumps({"sum": a ^ b ^ c, "cout": (a & b) | (c & (a ^ b))})}]})
    rows = rows * 5  # 40 tiny examples
    data = "\n".join(json.dumps(r) for r in rows).encode()
    bnd = "----" + uuid.uuid4().hex
    body = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nfine-tune\r\n"
            f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"tiny.jsonl\"\r\nContent-Type: application/jsonl\r\n\r\n").encode() + data + f"\r\n--{bnd}--\r\n".encode()
    t0 = time.time()
    f = http(FT, "/files", raw=body, ctype=f"multipart/form-data; boundary={bnd}")
    print("uploaded file", f.get("id"), f"in {time.time()-t0:.1f}s")
    base = next((a for a in sys.argv[2:] if not a.startswith("--")), None)
    if not base:
        cands = [m for m in http(FT, "/models")["data"] if "lightning" in json.dumps(m).lower()]
        base = cands[0]["id"] if cands else None
    print("base model:", base)
    if not base: sys.exit("No Lightning id found on the fine-tune endpoint; pass it explicitly: finetune <model_id>")
    job = http(FT, "/fine_tuning/jobs", {"model": base, "training_file": f["id"], "suffix": "lo-test",
               "method": {"type": "supervised", "supervised": {"hyperparameters": {"n_epochs": 1, "batch_size": "auto", "learning_rate": "auto"}}}})
    print("job", job.get("id"), job.get("status")); t1 = time.time(); last = None
    while True:
        j = http(FT, f"/fine_tuning/jobs/{job['id']}")
        if j.get("status") != last: print(f"  {time.time()-t1:7.0f}s  {j.get('status')}"); last = j.get("status")
        if j.get("status") in ("succeeded", "failed", "cancelled"): break
        time.sleep(20)
    print("RESULT:", j.get("status"), "fine_tuned_model:", j.get("fine_tuned_model"), f"train time {time.time()-t1:.0f}s")
    open(os.path.join(HERE, "finetune_result.json"), "w").write(json.dumps(j, indent=1))

def deploy(yes):
    if not yes: sys.exit("Deployment bills GPU-hours. Re-run with --yes only after the user agrees. Delete it right after testing.")
    j = json.load(open(os.path.join(HERE, "finetune_result.json")))
    print("Would deploy", j.get("fine_tuned_model"), "- see docs.crusoecloud.com/self-serve-deployments/quickstart for flavor_id; implement once the console shows the hourly price.")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "models"
    if cmd == "models": models()
    elif cmd == "probe": probe(sys.argv[2:] or DEFAULT_MODELS)
    elif cmd == "finetune": finetune()
    elif cmd == "deploy": deploy("--yes" in sys.argv)
    else: print(__doc__)
