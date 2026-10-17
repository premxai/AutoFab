"""Splice the tables from tools/report.py into README.md at the REPORT:* markers. Re-runnable: each marker keeps its
comment line and the generated block sits between it and the next '<!-- /REPORT -->' line (added on first run).
  python tools/fill_readme.py [runs/run.json]"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = os.path.join(ROOT, "README.md")
args = sys.argv[1:]
out = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "report.py"), *args], capture_output=True, text=True,
                     encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"}).stdout

def section(title):
    m = re.search(rf"^## {re.escape(title)}.*?$\n(.*?)(?=^## |\Z)", out, re.M | re.S)
    return (m.group(1).strip() + "\n") if m else ""

blocks = {"EXAM": section("Exam"), "SHIFTS": section("Shift log"), "LESSONS": section("What the team wrote for itself"),
          "RECEIPTS": section("Receipts")}
text = open(README, encoding="utf-8").read()
for key, body in blocks.items():
    pat = re.compile(rf"(<!-- REPORT:{key}[^\n]*-->\n)(?:.*?<!-- /REPORT -->\n)?", re.S)
    if not pat.search(text):
        print(f"marker REPORT:{key} not found"); continue
    text = pat.sub(lambda m: m.group(1) + body + "<!-- /REPORT -->\n", text, count=1)
open(README, "w", encoding="utf-8", newline="\n").write(text)
print("README filled:", ", ".join(k for k, v in blocks.items() if v))
