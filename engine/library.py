"""Shared Brain: the verified parts library + the lessons index.
Agents READ an index (small, byte-identical within a version -> MemoryAlloy cache hits) before working
and the investigator WRITES after. Persisted as JSON under snapshots/. See docs/CONTRACTS.md §3, §5."""
import json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "snapshots", "library.json")


class Library:
    def __init__(self, parts=None, lessons=None):
        self.parts: dict[str, dict] = dict(parts or {})     # id -> part (CONTRACTS §3)
        self.lessons: list[dict] = list(lessons or [])       # CONTRACTS §5

    # ---------- persistence
    @classmethod
    def load(cls, path=PATH):
        if not os.path.exists(path):
            return cls()
        d = json.load(open(path, encoding="utf-8"))
        return cls(d.get("parts"), d.get("lessons"))

    def save(self, path=PATH):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump({"parts": self.parts, "lessons": self.lessons, "saved": time.strftime("%Y-%m-%dT%H:%M:%S")},
                  open(path, "w", encoding="utf-8"), indent=1)

    def snapshot_view(self):
        """A frozen copy for a version (exam mode reads this, never writes)."""
        return Library(json.loads(json.dumps(self.parts)), json.loads(json.dumps(self.lessons)))

    # ---------- parts
    def add_part(self, part_id, ports, blueprint, gates, shift):
        if part_id in self.parts:                      # keep the smaller verified version
            if gates >= self.parts[part_id]["gates"]:
                return False
        self.parts[part_id] = {"id": part_id, "ports": ports, "blueprint": blueprint,
                               "verified": True, "gates": gates, "born_shift": shift}
        return True

    def parts_index(self, limit=40):
        """Compact, sorted, deterministic -> stable prefix."""
        rows = []
        for pid in sorted(self.parts)[:limit]:
            p = self.parts[pid]
            rows.append(f"- {pid}: inputs {','.join(p['ports']['inputs'])} -> outputs {','.join(p['ports']['outputs'])} ({p['gates']} gates, verified)")
        return "\n".join(rows) if rows else "- (empty: only primitive gates AND, OR, XOR, NOT, NAND exist)"

    # ---------- lessons
    def add_lesson(self, when, pitfall, verification, category, shift):
        lid = f"L{len(self.lessons) + 1:03d}"
        self.lessons.append({"id": lid, "when": when, "pitfall": pitfall, "verification": verification,
                             "category": category, "born_shift": shift, "hits": 0, "active": True})
        return lid

    def active_lessons(self, ids=None):
        ls = [l for l in self.lessons if l["active"] and (ids is None or l["id"] in ids)]
        return sorted(ls, key=lambda l: l["id"])

    def lessons_index(self, ids=None, limit=30):
        rows = [f"- {l['id']} ({l['category']}): when {l['when']}: {l['pitfall']} -> {l['verification']}"
                for l in self.active_lessons(ids)[:limit]]
        return "\n".join(rows) if rows else "- (no lessons yet)"

    def retire_unused(self, max_idle_shifts, current_shift):
        for l in self.lessons:
            if l["active"] and l["hits"] == 0 and current_shift - l["born_shift"] >= max_idle_shifts:
                l["active"] = False
