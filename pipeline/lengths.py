"""Muscle length for the contraction / stretch colouring.

The path of a muscle is   origin centre  ->  (optional via point on a bone)  ->  insertion centre,
where each centre is the area-weighted centre of the extracted attachment areas (pipeline.attachments). A centre that
is spread over several rigid bodies (e.g. latissimus dorsi on pelvis and thorax) moves as the weighted mix of them.

  length(pose) / length(rest)  < 1  muscle is shortened   (red)
                               > 1  muscle is lengthened  (blue)

This is deliberately simple (a straight line, or two segments around a bone) and fully described by a handful of
numbers per muscle, so the viewer can recompute it for any pose and a clinician can review the inputs.

A path point is stored as terms [(joint index, [x, y, z, w])]: its posed position is  sum_j S_j . term_j,
S_j being the skin matrix of rigid body j (see pipeline.skeleton.skin_matrices).
"""
from __future__ import annotations

import numpy as np

from pipeline import anatomy as an
from pipeline import landmarks as lm
from pipeline import skeleton as sk
from pipeline import za
from pipeline.attachments import MuscleResult

Terms = list[tuple[int, np.ndarray]]


def attachment_terms(res: MuscleResult, role: str, skel: sk.Skeleton, bone_defs: dict[str, an.Bone],
                     joint_names: list[str]) -> Terms:
    ps = [p for p in res.patches if p.role == role]
    if not ps:
        raise ValueError(f"{res.muscle}/{res.side}: no {role} patches")
    total = sum(p.area for p in ps)
    acc: dict[int, np.ndarray] = {}
    for p in ps:
        j = joint_names.index(sk.body_of_bone(skel, bone_defs[p.bone], p.bone_side))
        acc[j] = acc.get(j, np.zeros(4)) + np.r_[p.center, 1.0] * (p.area / total)
    return list(acc.items())


def via_terms(m: an.Muscle, side: str, skel: sk.Skeleton, bone_defs: dict[str, an.Bone], joint_names: list[str],
              ix: dict) -> Terms | None:
    if not m.via:
        return None
    bone = bone_defs[m.via["bone"]]
    bs = side if bone.sided else None
    verts = lm._bone_vertices(bone, bs, None, ix)
    p = verts[lm.pick_extreme(verts, lm.dir_vector(m.via["dir"], side), within=m.via.get("within"), side=side)]
    return [(joint_names.index(sk.body_of_bone(skel, bone, bs)), np.r_[p, 1.0])]


def build_paths(a: an.Anatomy, results: list[MuscleResult], skel: sk.Skeleton, ix: dict | None = None) -> dict[tuple[str, str], list[Terms]]:
    ix = ix or za.index()
    names = list(skel.bodies)
    bone_defs = {b.id: b for b in a.bones}
    by_ms = {(r.muscle, r.side): r for r in results}
    out: dict[tuple[str, str], list[Terms]] = {}
    for m in a.muscles:
        for side in an.SIDES:
            res = by_ms[(m.id, side)]
            path = [attachment_terms(res, "origin", skel, bone_defs, names)]
            v = via_terms(m, side, skel, bone_defs, names, ix)
            if v:
                path.append(v)
            path.append(attachment_terms(res, "insertion", skel, bone_defs, names))
            out[(m.id, side)] = path
    return out


def path_points(path: list[Terms], mats: list[np.ndarray]) -> np.ndarray:
    return np.array([sum((mats[j] @ t)[:3] for j, t in point) for point in path])


def path_length(path: list[Terms], mats: list[np.ndarray]) -> float:
    return float(np.linalg.norm(np.diff(path_points(path, mats), axis=0), axis=1).sum())


def mats_list(skel: sk.Skeleton, pose: dict[str, float]) -> list[np.ndarray]:
    m = sk.skin_matrices(skel, pose)
    return [m[b] for b in skel.bodies]


def ratios(skel: sk.Skeleton, paths: dict, pose: dict[str, float]) -> dict[tuple[str, str], float]:
    """Length(pose) / Length(rest) for every (muscle, side)."""
    rest = mats_list(skel, {})
    cur = mats_list(skel, pose)
    return {k: path_length(p, cur) / path_length(p, rest) for k, p in paths.items()}


def to_manifest(paths: dict) -> dict:
    """{muscle: {side: [[ [joint, x, y, z, w], ... ] per path point]}}"""
    out: dict = {}
    for (mid, side), path in paths.items():
        out.setdefault(mid, {})[side] = [
            [[j, *[round(float(x), 7) for x in t]] for j, t in point] for point in path
        ]
    return out
