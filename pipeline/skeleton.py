"""Rigid-body skeleton: structure from anatomy/skeleton.yaml, joint centres computed from the meshes,
and forward kinematics (the web viewer implements the same maths; golden vectors keep them in sync).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from pipeline import anatomy as an

SIDES = an.SIDES


@dataclass
class Dof:
    name: str
    axis: np.ndarray  # parent-frame rotation axis (already mirrored for the left side)
    sign: float
    share: float = 1.0


@dataclass
class Body:
    id: str
    parent: str | None
    center: np.ndarray | None = None  # world rest position of the joint to the parent
    dofs: list[Dof] = field(default_factory=list)
    trunk: bool = False
    span: bool = False
    frame_from: str | None = None
    spec: dict = field(default_factory=dict)  # how the centre is computed (from yaml)
    side: str | None = None


@dataclass
class Skeleton:
    bodies: dict[str, Body]  # parent-first order
    trunk_dofs: list[dict]  # [{name, axis, sign, shares:{body: share}}]

    def children(self, bid: str) -> list[str]:
        return [b.id for b in self.bodies.values() if b.parent == bid]

    def path_to_root(self, bid: str) -> list[str]:
        out = []
        cur: str | None = bid
        while cur is not None:
            out.append(cur)
            cur = self.bodies[cur].parent
        return out

    def path(self, a: str, b: str) -> list[str]:
        """Bodies on the tree path from a to b (inclusive)."""
        pa, pb = self.path_to_root(a), self.path_to_root(b)
        common = next(x for x in pa if x in pb)
        return pa[: pa.index(common) + 1] + list(reversed(pb[: pb.index(common)]))

    def pose_keys(self) -> list[str]:
        keys = [d["name"] for d in self.trunk_dofs]
        for b in self.bodies.values():
            keys += [d.name for d in b.dofs]
        return list(dict.fromkeys(keys))


def mirror_axis(axis, side: str) -> np.ndarray:
    a = np.asarray(axis, dtype=float)
    return a if side == "r" else np.array([a[0], -a[1], -a[2]])


def _expand(name: str, spec: dict, side: str | None) -> tuple[str, dict]:
    sub = lambda v: v.replace("{s}", side) if isinstance(v, str) and side else v  # noqa: E731
    out = dict(spec)
    out["parent"] = sub(spec.get("parent"))
    if "center" in spec and isinstance(spec["center"], dict):
        out["center"] = {k: sub(v) for k, v in spec["center"].items()}
    return sub(name), out


def load(doc: dict | None = None) -> Skeleton:
    doc = doc or an.read_yaml("skeleton.yaml")
    bodies: dict[str, Body] = {}
    for name, spec in doc["bodies"].items():
        sides = SIDES if "{s}" in name else (None,)
        for s in sides:
            bid, sp = _expand(name, spec, s)
            dofs = []
            for d in spec.get("dofs", []):
                prefix = f"{s}_" if s else ""
                dofs.append(Dof(prefix + d["name"], mirror_axis(d["axis"], s or "r"), float(d["sign"]), float(d.get("share", 1.0))))
            bodies[bid] = Body(bid, sp["parent"], None, dofs, bool(spec.get("trunk")), bool(spec.get("span")), spec.get("frame_from"), sp.get("center", {}), s)
    # parent-first order and sanity
    ordered: dict[str, Body] = {}
    pending = dict(bodies)
    while pending:
        progressed = False
        for bid, b in list(pending.items()):
            if b.parent is None or b.parent in ordered:
                ordered[bid] = pending.pop(bid)
                progressed = True
        if not progressed:
            raise ValueError(f"cyclic or dangling parents: {list(pending)}")
    tdofs = [{**d, "axis": np.asarray(d["axis"], float)} for d in doc.get("trunk_dofs", [])]
    for d in tdofs:
        total = sum(d["shares"].values())
        if abs(total - 1) > 1e-9:
            raise ValueError(f"trunk dof {d['name']}: shares sum to {total}, expected 1")
        unknown = set(d["shares"]) - {k for k, b in ordered.items() if b.trunk}
        if unknown:
            raise ValueError(f"trunk dof {d['name']}: shares for non-trunk bodies {unknown}")
    return Skeleton(ordered, tdofs)


def body_of_bone(skel: Skeleton, bone: an.Bone, side: str | None) -> str:
    """Rigid body that carries a bone: the body id from bones.yaml, with the side suffix when that body is sided."""
    sided = f"{bone.body}.{side}" if side else None
    if sided and sided in skel.bodies:
        return sided
    if bone.body in skel.bodies:
        return bone.body
    raise KeyError(f"bone {bone.id}: unknown body {bone.body!r}")


# ---------------------------------------------------------------- kinematics
def rot(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    a = np.asarray(axis, float)
    n = np.linalg.norm(a)
    if n == 0 or angle_rad == 0:
        return np.eye(3)
    x, y, z = a / n
    c, s = np.cos(angle_rad), np.sin(angle_rad)
    C = 1 - c
    return np.array([
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ])


def translation(t) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = t
    return m


def own_rotation(skel: Skeleton, bid: str, pose: dict[str, float]) -> np.ndarray:
    """The rotation the pose asks for, before any change of reference frame."""
    b = skel.bodies[bid]
    r = np.eye(3)
    if b.trunk:
        # composition order: rotation(y) . lateral(z) . flexion(x)
        by_name = {d["name"]: d for d in skel.trunk_dofs}
        for name in ("trunk_rotation", "trunk_lateral", "trunk_flexion"):
            d = by_name.get(name)
            if d and bid in d["shares"]:
                r = r @ rot(d["axis"], np.deg2rad(pose.get(name, 0.0) * d["sign"] * d["shares"][bid]))
    for d in b.dofs:
        r = r @ rot(d.axis, np.deg2rad(pose.get(d.name, 0.0) * d.sign * d.share))
    return r


def body_rotation(skel: Skeleton, bid: str, pose: dict[str, float]) -> np.ndarray:
    """Local rotation relative to the parent. With `frame_from`, the DOFs act in that ancestor's frame:
    local = (rotations of the bodies between the ancestor and this body)^-1 . own rotation."""
    r = own_rotation(skel, bid, pose)
    anc = skel.bodies[bid].frame_from
    if anc:
        between = []
        cur = skel.bodies[bid].parent
        while cur is not None and cur != anc:
            between.append(cur)
            cur = skel.bodies[cur].parent
        comp = np.eye(3)
        for b in reversed(between):  # from the ancestor's child down to this body's parent
            comp = comp @ own_rotation(skel, b, pose)
        r = comp.T @ r
    return r


def skin_matrices(skel: Skeleton, pose: dict[str, float]) -> dict[str, np.ndarray]:
    """S_b = W_b(pose) . W_b(rest)^-1: maps a rest-pose world point of body b to its posed position."""
    world: dict[str, np.ndarray] = {}
    out: dict[str, np.ndarray] = {}
    for bid, b in skel.bodies.items():
        local = np.eye(4)
        local[:3, :3] = body_rotation(skel, bid, pose)
        c = b.center
        if b.parent is None:
            local[:3, 3] = c
            world[bid] = local
        else:
            local[:3, 3] = c - skel.bodies[b.parent].center
            world[bid] = world[b.parent] @ local
        out[bid] = world[bid] @ translation(-c)
    return out


def apply(mats: dict[str, np.ndarray], body: str, pts: np.ndarray) -> np.ndarray:
    m = mats[body]
    return pts @ m[:3, :3].T + m[:3, 3]
