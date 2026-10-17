"""Print the README tables from runs/run.json: the exam ablation, the shift log (kept/rejected), lessons.
  python tools/report.py [runs/run.json]"""
import json, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "runs", "run.json")
s = json.load(open(path, encoding="utf-8"))

print("## Exam: the same 40 unseen orders, every version\n")
print("| Version | Pass rate | Gates vs best known | Attempts | Cost / chip | Failures by category |")
print("|---|---|---|---|---|---|")
for v, e in s.get("exam", {}).items():
    cats = ", ".join(f"{k} {n}" for k, n in e["categories"].items() if n)
    print(f"| {v} | **{e['pass_rate']:.0%}** | {e.get('gates_vs_best') or '—'}× | {e.get('attempts', '—')} | ${e.get('cost_per_chip', 0):.3f} | {cats or 'none'} |")
print("\nBy rung:", {v: e["by_rung"] for v, e in s.get("exam", {}).items()})

print("\n## Shift log: one proposed change per shift, kept only if a fresh validation batch improved\n")
print("| Shift | Version | Dominant failures | Proposal | Verdict | Reason |")
print("|---|---|---|---|---|---|")
for sh in s.get("shifts", []):
    v = sh.get("validation") or {}
    cats = ", ".join(f"{k} {n}" for k, n in (sh.get("categories") or {}).items() if n) or "none"
    print(f"| {sh['shift']} | {sh['version']} | {cats} | {v.get('proposal', '—')} | **{v.get('verdict', '—')}** | {v.get('reason', '')} |")

lib_path = os.path.join(ROOT, "snapshots", "library.json")
if os.path.exists(lib_path):
    lib = json.load(open(lib_path, encoding="utf-8"))
    print(f"\n## What the team wrote for itself\n\n{len(lib['lessons'])} lessons, {len(lib['parts'])} verified library parts.\n")
    for l in lib["lessons"][:12]:
        print(f"- **{l['id']}** ({l['category']}, shift {l['born_shift']}, used {l['hits']}×): when {l['when']}: *{l['pitfall']}* → {l['verification']}")
g = s.get("gauges", {})
print(f"\n## Receipts\n\nTotal spend ${g.get('cost_total_usd', 0):.2f} · {g.get('tok_s')} tok/s · TTFT {g.get('ttft_s') or 0:.2f}s · cache hit {g.get('cache_rate', 0):.0%} · {g.get('chips_per_hour')} chips/hour · human pings {g.get('human_pings')}")
