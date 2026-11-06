"""Validate anatomy/*.yaml against the schema and the Z-Anatomy mesh set.

Usage: python -m pipeline.validate        (exit code 1 on errors)
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from dataclasses import dataclass

from pipeline import anatomy as an

LANGS = ("zh", "en", "la")
LAYERS = {"superficial", "intermediate", "deep"}
KINDS = {"muscle", "fascia"}


@dataclass
class Issue:
    level: str  # error | warn
    where: str
    msg: str

    def __str__(self) -> str:
        return f"[{self.level.upper()}] {self.where}: {self.msg}"


def _text_ok(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def validate(a: an.Anatomy, za_index: dict[str, dict]) -> list[Issue]:
    issues: list[Issue] = []

    def err(where: str, msg: str) -> None:
        issues.append(Issue("error", where, msg))

    # ---- regions / groups
    for rid, r in a.regions.items():
        for lg in LANGS:
            if not _text_ok(r.get(lg)):
                err(f"region {rid}", f"missing name.{lg}")
    for gid, g in a.groups.items():
        for lg in ("zh", "en"):
            if not _text_ok(g.get(lg)):
                err(f"group {gid}", f"missing {lg}")

    # ---- bones
    seen = Counter(b.id for b in a.bones)
    for bid, n in seen.items():
        if n > 1:
            err(f"bone {bid}", "duplicate id")
    bone_ids = set(seen)
    mesh_owner: dict[str, str] = {}
    for b in a.bones:
        w = f"bone {b.id}"
        for lg in LANGS:
            if not _text_ok(b.name.get(lg)):
                err(w, f"missing name.{lg}")
        if not b.za and not b.za_re:
            err(w, "needs za or za_re")
        if not _text_ok(b.body):
            err(w, "missing body")
        for r in b.regions:
            if r not in a.regions:
                err(w, f"unknown region {r!r}")
        for side in b.sides():
            meshes = b.resolve(za_index, side)
            if not meshes:
                err(w, f"no Z-Anatomy mesh found (side={side})")
            for m in meshes:
                if m in mesh_owner and mesh_owner[m] != b.id:
                    err(w, f"mesh {m!r} already used by bone {mesh_owner[m]}")
                mesh_owner[m] = b.id
            if b.za:
                missing = [n for n in b.za if (f"{n}.{side}" if side else n) not in za_index]
                if missing:
                    err(w, f"missing meshes {missing}")

    # ---- muscles
    seen_m = Counter(m.id for m in a.muscles)
    for mid, n in seen_m.items():
        if n > 1:
            err(f"muscle {mid}", "duplicate id")
    za_used: dict[str, str] = {}
    for m in a.muscles:
        w = f"muscle {m.id}"
        for lg in LANGS:
            if not _text_ok(m.name.get(lg)):
                err(w, f"missing name.{lg}")
        for fld in ("origin", "insertion", "function"):
            for lg in ("zh", "en"):
                if not _text_ok(getattr(m, fld).get(lg)):
                    err(w, f"missing {fld}.{lg}")
        if m.layer not in LAYERS:
            err(w, f"layer must be one of {sorted(LAYERS)}")
        if m.kind not in KINDS:
            err(w, f"kind must be one of {sorted(KINDS)}")
        if m.group not in a.groups:
            err(w, f"unknown group {m.group!r}")
        if not m.regions:
            err(w, "no regions")
        for r in m.regions:
            if r not in a.regions:
                err(w, f"unknown region {r!r}")
        for fld in ("origin_bones", "insertion_bones"):
            ids = getattr(m, fld)
            if not ids:
                err(w, f"{fld} is empty")
            for bid in ids:
                if bid not in bone_ids:
                    err(w, f"{fld}: unknown bone {bid!r}")
        for side in an.SIDES:
            zn = m.za_name(side)
            if zn not in za_index:
                err(w, f"Z-Anatomy mesh {zn!r} not found")
            elif not za_index[zn]["collection"].startswith("4:"):
                err(w, f"{zn!r} is not in the muscular system collection")
            if zn in za_used:
                err(w, f"mesh {zn!r} already used by muscle {za_used[zn]}")
            za_used[zn] = m.id
    return issues


def validate_landmarks(a: an.Anatomy, defs: list[dict]) -> list[Issue]:
    issues: list[Issue] = []
    seen = Counter(d["id"] for d in defs)
    muscle_ids = {m.id for m in a.muscles}
    bone_ids = {b.id for b in a.bones}
    dirs = {"anterior", "posterior", "superior", "inferior", "lateral", "medial"}
    for d in defs:
        w = f"landmark {d['id']}"
        if seen[d["id"]] > 1:
            issues.append(Issue("error", w, "duplicate id"))
        if d.get("bone") not in bone_ids:
            issues.append(Issue("error", w, f"unknown bone {d.get('bone')!r}"))
        for lg in LANGS:
            if not _text_ok(d.get("name", {}).get(lg)):
                issues.append(Issue("error", w, f"missing name.{lg}"))
        for lg in ("zh", "en"):
            if not _text_ok(d.get("palpation", {}).get(lg)):
                issues.append(Issue("error", w, f"missing palpation.{lg}"))
        for key in ("dir", "project"):
            for k in d.get(key, {}):
                if k not in dirs:
                    issues.append(Issue("error", w, f"{key}: unknown direction {k!r}"))
        if not d.get("dir"):
            issues.append(Issue("error", w, "missing dir"))
        for r in d.get("regions", []):
            if r not in a.regions:
                issues.append(Issue("error", w, f"unknown region {r!r}"))
        for m in d.get("related", []):
            if m not in muscle_ids:
                issues.append(Issue("error", w, f"related: unknown muscle {m!r}"))
        if d.get("midline") and any(k in d["dir"] for k in ("lateral", "medial")):
            issues.append(Issue("error", w, "midline landmarks cannot use lateral/medial"))
    return issues


def coverage(a: an.Anatomy, za_index: dict[str, dict]) -> list[str]:
    lines = []
    by_region: dict[str, list[an.Muscle]] = defaultdict(list)
    for m in a.muscles:
        for r in m.regions:
            by_region[r].append(m)

    def pct(n: int, d: int) -> str:
        return f"{100 * n // d:3d}%" if d else "  - "

    lines.append(f"{'region':<10}{'muscles':>8}  zh    en    la    origin/ins  bones  mesh")
    for rid in a.regions:
        ms = by_region.get(rid, [])
        n = len(ms)

        def have(f):
            return sum(1 for m in ms if _text_ok(f(m)))

        lines.append(
            f"{rid:<10}{n:>8}  "
            f"{pct(have(lambda m: m.name.get('zh')), n)}  {pct(have(lambda m: m.name.get('en')), n)}  "
            f"{pct(have(lambda m: m.name.get('la')), n)}  "
            f"{pct(sum(1 for m in ms if _text_ok(m.origin.get('zh')) and _text_ok(m.insertion.get('zh'))), n)}"
            f"        {pct(sum(1 for m in ms if m.origin_bones and m.insertion_bones), n)}  "
            f"{pct(sum(1 for m in ms if all(m.za_name(s) in za_index for s in an.SIDES)), n)}"
        )
    lines.append(f"\ntotal: {len(a.muscles)} muscles/fasciae x2 sides, {len(a.bones)} bone entries, "
                 f"{len(a.groups)} groups")
    layers = Counter(m.layer for m in a.muscles)
    lines.append("layers: " + ", ".join(f"{k}={v}" for k, v in sorted(layers.items())))
    return lines


def main() -> int:
    from pipeline import za

    a = an.load()
    ix = za.index()
    issues = validate(a, ix) + validate_landmarks(a, an.read_yaml("landmarks.yaml")["landmarks"])
    print("\n".join(coverage(a, ix)))
    print()
    for i in issues:
        print(i)
    errors = [i for i in issues if i.level == "error"]
    print(f"\n{len(errors)} error(s), {len(issues) - len(errors)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
