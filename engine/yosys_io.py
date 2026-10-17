"""Yosys/ABC helpers (CONTRACTS section 1 `best_known_gates` and section 10 Yosys JSON export).

* ``best_known_gates(order)``  - gate count of the Yosys/ABC mapping of the order's truth table.
* ``to_yosys_json(flat_blueprint)`` - flattened Blueprint -> Yosys JSON for netlistsvg.

Stdlib + ``yowasp-yosys`` only. Yosys runs in a child process whose working directory is a
fresh folder next to ``orders/`` and every file is addressed by a *relative* name (the WASI
runtime inside yowasp cannot open Windows 8.3 short paths).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORDERS_DIR = ROOT / "orders"
CACHE_PATH = ORDERS_DIR / "yosys_cache.json"
TMP_DIR = ORDERS_DIR / "_yosys_tmp"

GENERAL_GATES = "AND,NAND,OR,NOR,XOR,XNOR"
_CACHE_LOCK = threading.Lock()
_TIMEOUT_S = 240  # first run compiles the WASM module

_RUNNER = (
    "import sys, yowasp_yosys\n"
    "sys.exit(yowasp_yosys.run_yosys(['-q', '-p', sys.argv[1]]))\n"
)


# --------------------------------------------------------------------------- cache
def _load_cache() -> dict:
    try:
        with open(CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_cache(cache: dict) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = CACHE_PATH.with_name(f"yosys_cache.{uuid.uuid4().hex}.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=1, sort_keys=True)
        os.replace(tmp, CACHE_PATH)
    except Exception:
        pass


def truth_hash(order: dict, nand_only: bool) -> str:
    """Stable hash of the function (inputs, outputs, truth) plus the mapping mode."""
    payload = {
        "inputs": list(order["inputs"]),
        "outputs": list(order["outputs"]),
        "truth": {k: {o: int(v[o]) for o in order["outputs"]} for k, v in sorted(order["truth"].items())},
        "mode": "NAND" if nand_only else "GENERAL",
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:24]


# --------------------------------------------------------------------------- BLIF
def truth_to_blif(order: dict, model: str = "o") -> str:
    """BLIF with one `.names` block per output listing its on-set (one row per minterm)."""
    ins, outs, truth = order["inputs"], order["outputs"], order["truth"]
    lines = [f".model {model}", ".inputs " + " ".join(ins), ".outputs " + " ".join(outs)]
    for o in outs:
        lines.append(".names " + " ".join(ins + [o]))
        for key in sorted(truth):
            if int(truth[key][o]):
                lines.append(f"{key} 1")
    lines.append(".end")
    return "\n".join(lines) + "\n"


def _run_yosys(blif: str, nand_only: bool) -> int | None:
    work = TMP_DIR / uuid.uuid4().hex[:12]
    try:
        work.mkdir(parents=True, exist_ok=True)
        work = Path(os.path.realpath(work))
        (work / "o.blif").write_text(blif, encoding="utf-8")
        gates = "NAND" if nand_only else GENERAL_GATES
        script = (
            "read_blif o.blif; synth -top o; "
            f"abc -g {gates}; opt_clean; tee -o stat.txt stat"
        )
        proc = subprocess.run(
            [sys.executable, "-c", _RUNNER, script],
            cwd=str(work), capture_output=True, text=True, timeout=_TIMEOUT_S,
        )
        if proc.returncode != 0:
            return None
        stat = (work / "stat.txt").read_text(encoding="utf-8", errors="replace")
        if "=== o ===" not in stat:
            return None
        m = re.search(r"^\s*(\d+)\s+cells\s*$", stat, re.M)
        return int(m.group(1)) if m else 0
    except Exception:
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            TMP_DIR.rmdir()  # only succeeds when empty
        except OSError:
            pass


def best_known_gates(order: dict) -> int | None:
    """Yosys/ABC gate count for a combinational order, or None if unavailable.

    Orders whose only allowed gate is NAND are mapped with `abc -g NAND` (NOT counts as one gate).
    """
    try:
        if not order.get("truth"):
            return None
        nand_only = list(order.get("allowed_gates") or []) == ["NAND"]
        key = truth_hash(order, nand_only)
        with _CACHE_LOCK:
            cached = _load_cache().get(key)
        if isinstance(cached, int):
            return cached
        n = _run_yosys(truth_to_blif(order), nand_only)
        if n is None:
            return None
        with _CACHE_LOCK:
            cache = _load_cache()
            cache[key] = n
            _save_cache(cache)
        return n
    except Exception:
        return None


# --------------------------------------------------------------------------- Yosys JSON
_CELL_TYPES = {"AND": "$_AND_", "OR": "$_OR_", "XOR": "$_XOR_", "NAND": "$_NAND_", "NOT": "$_NOT_"}


def to_yosys_json(flat_blueprint: dict, module_id: str = "chip") -> dict:
    """Flattened Blueprint (gates + flipflops, no instances) -> Yosys JSON (CONTRACTS section 10).

    Nets are ints (0/1 are reserved for constants, real nets start at 2). Output ports share the
    net of the signal they are mapped to. Flip-flops become `$_DFF_P_` (D, C, Q) on a `clk` input.
    """
    bp = flat_blueprint
    nets: dict[str, int] = {}

    def net(sig: str) -> int:
        if sig in ("0", "1"):
            return int(sig)
        if sig not in nets:
            nets[sig] = len(nets) + 2
        return nets[sig]

    ports: dict[str, dict] = {}
    for name in bp.get("inputs", []):
        ports[name] = {"direction": "input", "bits": [net(name)]}
    flops = bp.get("flipflops") or []
    if flops:
        ports["clk"] = {"direction": "input", "bits": [net("clk")]}

    cells: dict[str, dict] = {}
    for g in bp.get("gates", []):
        t = g["type"]
        ins = g["inputs"]
        if t == "NOT":
            cells[g["name"]] = {
                "type": _CELL_TYPES[t],
                "port_directions": {"A": "input", "Y": "output"},
                "connections": {"A": [net(ins[0])], "Y": [net(g["output"])]},
            }
        else:
            cells[g["name"]] = {
                "type": _CELL_TYPES[t],
                "port_directions": {"A": "input", "B": "input", "Y": "output"},
                "connections": {"A": [net(ins[0])], "B": [net(ins[1])], "Y": [net(g["output"])]},
            }
    for ff in flops:
        cells[ff["name"]] = {
            "type": "$_DFF_P_",
            "port_directions": {"D": "input", "C": "input", "Q": "output"},
            "connections": {"D": [net(ff["d"])], "C": [net("clk")], "Q": [net(ff["name"])]},
        }
    for oname, sig in (bp.get("outputs") or {}).items():
        ports[oname] = {"direction": "output", "bits": [net(sig)]}

    netnames: dict[str, dict] = {}
    for sig, n in nets.items():
        netnames[sig] = {"bits": [n]}
    for oname, sig in (bp.get("outputs") or {}).items():
        if oname not in netnames:
            netnames[oname] = {"bits": [net(sig)]}
    return {"modules": {module_id: {"ports": ports, "cells": cells, "netnames": netnames}}}


if __name__ == "__main__":
    # tiny manual check:  python -m engine.yosys_io
    lock = {"inputs": list("abcd"), "outputs": ["y"], "allowed_gates": ["AND", "OR", "XOR", "NOT"],
            "truth": {format(i, "04b"): {"y": int(i in (3, 9, 13, 14))} for i in range(16)}}
    print("4-input lock baseline:", best_known_gates(lock))
