"""Motion library: loading, validation and keyframe interpolation (anatomy/motions.yaml)."""
from __future__ import annotations

import bisect
from dataclasses import dataclass

from pipeline import anatomy as an
from pipeline import skeleton as sk

ROLES = ("agonist", "stabilizer", "antagonist")
LIMBS = {"right", "trunk"}


@dataclass
class Issue:
    where: str
    msg: str

    def __str__(self) -> str:
        return f"{self.where}: {self.msg}"


def load() -> list[dict]:
    return an.read_yaml("motions.yaml")["motions"]


def interpolate(motion: dict, value: float) -> dict[str, float]:
    """Pose (DOF name -> degrees) for a parameter value: linear between keyframes, clamped outside."""
    kf = motion["keyframes"]
    xs = [k["at"] for k in kf]
    if value <= xs[0]:
        return dict(kf[0]["pose"])
    if value >= xs[-1]:
        return dict(kf[-1]["pose"])
    i = bisect.bisect_right(xs, value) - 1
    t = (value - xs[i]) / (xs[i + 1] - xs[i])
    a, b = kf[i]["pose"], kf[i + 1]["pose"]
    return {k: a[k] + t * (b[k] - a[k]) for k in a}


def direction_for(motion: dict, value: float) -> str:
    return "neg" if value < 0 and "neg" in motion["directions"] else "pos"


def resolve_role_entry(entry: str, limb: str, ipsi: str | None) -> list[tuple[str, str]]:
    """'id', 'id@ipsi', 'id@contra' -> [(muscle id, side)]. Limb motions act on the right side only."""
    mid, _, tag = entry.partition("@")
    if limb == "right":
        return [(mid, "r")]
    if tag == "ipsi":
        return [(mid, ipsi or "r")]
    if tag == "contra":
        return [(mid, "l" if (ipsi or "r") == "r" else "r")]
    return [(mid, "r"), (mid, "l")]


def validate(motions: list[dict], a: an.Anatomy, skel: sk.Skeleton) -> list[Issue]:
    out: list[Issue] = []
    muscle_ids = {m.id for m in a.muscles}
    pose_keys = set(skel.pose_keys())
    seen = set()
    for m in motions:
        w = f"motion {m.get('id')}"

        def add(msg: str, w: str = w) -> None:
            out.append(Issue(w, msg))

        if m.get("id") in seen:
            add("duplicate id")
        seen.add(m.get("id"))
        if m.get("region") not in a.regions:
            add(f"unknown region {m.get('region')!r}")
        if m.get("limb") not in LIMBS:
            add(f"limb must be one of {sorted(LIMBS)}")
        for lg in ("zh", "en"):
            if not m.get("name", {}).get(lg):
                add(f"missing name.{lg}")
            if not m.get("note", {}).get(lg):
                add(f"missing note.{lg}")
        p = m.get("param", {})
        if not (p.get("min") < p.get("max")) or not (p["min"] <= p.get("default", 0) <= p["max"]):
            add("param needs min < max and min <= default <= max")
        kf = m.get("keyframes", [])
        if len(kf) < 2:
            add("needs at least 2 keyframes")
            continue
        xs = [k["at"] for k in kf]
        if xs != sorted(xs) or len(set(xs)) != len(xs):
            add("keyframes must be strictly increasing in 'at'")
        if xs[0] != p["min"] or xs[-1] != p["max"]:
            add(f"keyframes must span the whole parameter range ({p['min']}..{p['max']}), got {xs[0]}..{xs[-1]}")
        keys = set(kf[0]["pose"])
        for k in kf:
            if set(k["pose"]) != keys:
                add(f"keyframe at {k['at']} uses a different set of pose keys")
        for key in keys:
            if key not in pose_keys:
                add(f"unknown pose key {key!r}")
            elif m.get("limb") == "right" and not key.startswith("r_"):
                add(f"limb motion uses non-right pose key {key!r}")
            elif m.get("limb") == "trunk" and not key.startswith("trunk_"):
                add(f"trunk motion uses pose key {key!r}")
        pl = m.get("play", [p["min"], p["max"]])
        if not (p["min"] <= pl[0] < pl[1] <= p["max"]):
            add("play range must lie inside the parameter range")

        dirs = m.get("directions", {})
        if "pos" not in dirs:
            add("missing 'pos' direction")
        if p["min"] < 0 and "neg" not in dirs:
            add("parameter goes negative but there is no 'neg' direction")
        if p["min"] >= 0 and "neg" in dirs:
            add("'neg' direction defined but the parameter never goes negative")
        for dname, d in dirs.items():
            dw = f"{w} / {dname}"
            for lg in ("zh", "en"):
                if not d.get("label", {}).get(lg):
                    out.append(Issue(dw, f"missing label.{lg}"))
            if m.get("limb") == "trunk" and m["id"] != "trunk_flexion" and d.get("ipsi") not in ("r", "l"):
                out.append(Issue(dw, "trunk side motions need ipsi: r|l"))
            used: dict[str, str] = {}
            for role in ROLES:
                for entry in d.get("roles", {}).get(role, []):
                    mid, _, tag = entry.partition("@")
                    if mid not in muscle_ids:
                        out.append(Issue(dw, f"{role}: unknown muscle {mid!r}"))
                    if tag not in ("", "ipsi", "contra"):
                        out.append(Issue(dw, f"{role}: bad side tag in {entry!r}"))
                    if tag and m.get("limb") != "trunk":
                        out.append(Issue(dw, f"{entry!r}: @ipsi/@contra only apply to trunk motions"))
                    if entry in used:
                        out.append(Issue(dw, f"{entry!r} is listed as both {used[entry]} and {role}"))
                    used[entry] = role
            if not d.get("roles", {}).get("agonist"):
                out.append(Issue(dw, "needs at least one agonist"))
            if not d.get("roles", {}).get("antagonist"):
                out.append(Issue(dw, "needs at least one antagonist"))
    return out
