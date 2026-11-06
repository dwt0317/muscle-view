"""Turn a review.json exported from the web viewer's review mode into a to-do list for attachment_overrides.yaml.

Usage: python -m pipeline.apply_review review.json [--out docs/REVIEW_TODO.md]

Nothing is written to attachment_overrides.yaml automatically (the file is hand-maintained and commented); the report
lists, for every muscle flagged as a problem, what the extraction produced, the reviewer's note and a ready-to-paste
override snippet for the most likely fix.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from pipeline import anatomy as an
from pipeline.paths import ROOT, WEB_DATA_DIR

TOO_LARGE = re.compile(r"过大|太大|过宽|太宽|偏大|too (large|big|wide)|oversized|spills?", re.I)
MISSING = re.compile(r"缺|没有|未|遗漏|missing|absent|not found|none", re.I)
WRONG_BONE = re.compile(r"错|不是|应该在|wrong|should be on|belongs", re.I)


@dataclass
class Todo:
    muscle: str
    note: str
    source: str  # algorithm | za | point | mixed | none
    origin_cm2: float
    insertion_cm2: float
    suggestions: list[str] = field(default_factory=list)
    snippets: list[str] = field(default_factory=list)


def _source_of(att: dict) -> str:
    srcs = {p["source"] for role in ("origin", "insertion") for p in att.get(role, [])}
    if not srcs:
        return "none"
    return srcs.pop() if len(srcs) == 1 else "mixed"


def build_todo(review: dict, attachments: dict, overrides: dict, has_decals) -> list[Todo]:
    """`has_decals(muscle_id) -> bool` tells whether Z-Anatomy ships hand-drawn attachment areas for the muscle."""
    existing = {o["muscle"]: o for o in overrides.get("overrides", [])}
    out: list[Todo] = []
    for item in review.get("items", []):
        if item.get("verdict") != "issue":
            continue
        mid = item["muscle"]
        att = attachments.get(mid, {}).get("r", {"origin": [], "insertion": []})
        note = item.get("note", "") or ""
        t = Todo(mid, note, _source_of(att),
                 sum(p["areaCm2"] for p in att.get("origin", [])), sum(p["areaCm2"] for p in att.get("insertion", [])))
        cur = existing.get(mid, {})
        cur_tau = cur.get("tau_mm")

        if t.source in ("algorithm", "mixed") and cur.get("source") != "za" and has_decals(mid):
            t.suggestions.append("Z-Anatomy 有手绘附着区，可直接采用。")
            t.snippets.append(f"- {{muscle: {mid}, source: za}}")
        if TOO_LARGE.search(note):
            tau = round((cur_tau or 2.5) * 0.6, 1)
            t.suggestions.append(f"附着区过大：把接触阈值调小（当前 {cur_tau or '默认 2.5'} mm）。")
            t.snippets.append(f"- {{muscle: {mid}, tau_mm: {tau}, min_cluster_cm2: 1.0}}")
        if MISSING.search(note) or t.origin_cm2 == 0 or t.insertion_cm2 == 0:
            role = "insertion" if t.insertion_cm2 == 0 else "origin"
            t.suggestions.append(
                f"{'起点' if role == 'origin' else '止点'}缺失或不完整：加大阈值，或在骨上补点状贴片（需写出骨、方向）。"
            )
            t.snippets.append(
                f"- muscle: {mid}\n    add_point_patch:\n"
                f"      - {{role: {role}, bone: <bone_id>, dir: {{<anatomical dir>: 1}}, radius_mm: 8}}"
            )
        if WRONG_BONE.search(note):
            t.suggestions.append("骨归属有误：检查 anatomy/muscles.yaml 的 origin_bones / insertion_bones，再重新导出。")
        if not t.suggestions:
            t.suggestions.append("按备注人工处理；可先用 `drop` 删除多余簇（见 attachment_overrides.yaml 头部说明）。")
            t.snippets.append(f"- muscle: {mid}\n    drop:\n      - {{role: origin, bone: <bone_id>, near: [x, y, z], radius_mm: 15}}")
        out.append(t)
    return out


def render_markdown(todos: list[Todo], reviewed: int, total_items: int) -> str:
    lines = ["# 起止点校对待办", "",
             f"来源 review.json：共 {total_items} 条校对记录，其中 {len(todos)} 条标记为有问题。", ""]
    if not todos:
        lines.append("没有需要修正的条目。")
        return "\n".join(lines) + "\n"
    snippets: list[str] = []
    for t in todos:
        lines += [f"## {t.muscle}", "",
                  f"- 当前来源：{t.source}；起点面积 {t.origin_cm2:.1f} cm²，止点面积 {t.insertion_cm2:.1f} cm²",
                  f"- 备注：{t.note or '（无）'}"]
        lines += [f"- 建议：{s}" for s in t.suggestions]
        lines.append("")
        snippets += t.snippets
    lines += ["## 可粘贴到 anatomy/attachment_overrides.yaml 的片段（请先核对）", "", "```yaml", *snippets, "```", "",
              "修改后运行 `python -m pipeline.attachments` 查看报告，再 `python -m pipeline.export` 重新导出。", ""]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("review", type=Path)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "REVIEW_TODO.md")
    args = ap.parse_args()

    review = json.loads(args.review.read_text(encoding="utf-8"))
    manifest = json.loads((WEB_DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    a = an.load()
    from pipeline import za

    by_id = {m.id: m for m in a.muscles}

    def has_decals(mid: str) -> bool:
        ref = za.reference_patches(by_id[mid].za, "r")
        return bool(ref["origin"] or ref["insertion"])

    overrides = an.read_yaml("attachment_overrides.yaml")
    todos = build_todo(review, manifest["attachments"], overrides, has_decals)
    n = len(review.get("items", []))
    md = render_markdown(todos, n, n)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(md, encoding="utf-8")
    print(f"{len(todos)} muscle(s) flagged -> {args.out}")


if __name__ == "__main__":
    main()
