"""Skin weights.

Muscles: "anchored interpolation". Every body that carries part of the muscle's attachment (plus span bodies the
muscle passes over, e.g. the femur for rectus femoris, lumbar vertebrae for the erector spinae) gets an anchor point.
Anchors are ordered along the muscle's axis (origin -> insertion) and each vertex blends the two neighbouring anchors'
bodies with a smoothstep of its position between them. Beyond the first / last anchor a vertex follows that body fully.

Skin: soft nearest-bone weights (up to 4 bodies), so the skin follows the limbs when they move.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from pipeline import anatomy as an
from pipeline import skeleton as sk
from pipeline.attachments import MuscleResult, Patch

MIN_WEIGHT = 0.01


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def body_anchors(patches: list[Patch], skel: sk.Skeleton, bone_defs: dict[str, an.Bone]) -> tuple[dict[str, np.ndarray], dict[str, float], dict[str, float]]:
    """Area-weighted anchor per body, plus the origin / insertion area carried by each body."""
    acc: dict[str, list] = {}
    area = {"origin": {}, "insertion": {}}
    for p in patches:
        body = sk.body_of_bone(skel, bone_defs[p.bone], p.bone_side)
        e = acc.setdefault(body, [np.zeros(3), 0.0])
        e[0] += p.center * p.area
        e[1] += p.area
        area[p.role][body] = area[p.role].get(body, 0.0) + p.area
    return {b: v[0] / v[1] for b, v in acc.items()}, area["origin"], area["insertion"]


def span_anchors(skel: sk.Skeleton, o: str, i: str, have: set[str]) -> dict[str, np.ndarray]:
    """Anchors for span bodies on the tree path o -> i that carry no attachment themselves (segment midpoints)."""
    path = skel.path(o, i)
    out: dict[str, np.ndarray] = {}
    for k, bid in enumerate(path):
        b = skel.bodies[bid]
        if bid in have or not b.span:
            continue
        nbrs = [path[j] for j in (k - 1, k + 1) if 0 <= j < len(path)]
        child_on_path = [n for n in nbrs if skel.bodies[n].parent == bid]
        if child_on_path:  # the distal end of this segment is the joint to its child on the path
            out[bid] = (b.center + skel.bodies[child_on_path[0]].center) / 2
        elif b.parent is not None:
            out[bid] = (b.center + skel.bodies[b.parent].center) / 2
    return out


def trunk_chain(skel: sk.Skeleton) -> list[str]:
    """Bodies from the root up through the spine, in order (pelvis, l5 ... l1, thorax)."""
    chain = [b for b, v in skel.bodies.items() if v.parent is None]
    while True:
        nxt = [c for c in skel.children(chain[-1]) if skel.bodies[c].trunk]
        if not nxt:
            return chain
        chain.append(nxt[0])


def trunk_level(skel: sk.Skeleton, body: str, chain: list[str]) -> int:
    """Index in the trunk chain of the nearest ancestor-or-self of `body` that lies on it."""
    cur: str | None = body
    while cur is not None:
        if cur in chain:
            return chain.index(cur)
        cur = skel.bodies[cur].parent
    return 0


def trunk_span_anchors(skel: sk.Skeleton, have: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Spine segments take part when the muscle reaches over them.

    A body hanging off the spine (scapula, humerus, ...) rides on the thorax, so for the lumbar levels it counts as
    sitting at the thorax's level; if the muscle also has an anchor on the pelvis side, each spine segment in between
    (and the thorax itself) gets an anchor, so trunk flexion is shared by all levels instead of being sheared
    between two distant anchors."""
    chain = trunk_chain(skel)
    levels = {b: trunk_level(skel, b, chain) for b in have}
    lo, hi = min(levels.values()), max(levels.values())
    out: dict[str, np.ndarray] = {}
    for k in range(lo + 1, hi + 1):
        bid = chain[k]
        if bid in have or not skel.bodies[bid].trunk:
            continue
        nxt = chain[k + 1] if k + 1 < len(chain) else None
        c = skel.bodies[bid].center
        out[bid] = (c + skel.bodies[nxt].center) / 2 if nxt else c + np.array([0.0, 0.05, 0.0])
    return out


MIN_ANCHOR_GAP = 0.025  # m: spine segments need at least this much room to share a rotation


def enforce_spine_order(skel: sk.Skeleton, s: dict[str, float]) -> dict[str, float]:
    """Make the anchors of the trunk chain follow the spine's order (pelvis ... thorax, monotone along the muscle axis)
    with a minimum gap, so that nearby attachments on neighbouring segments do not collapse the blend into a hinge."""
    chain = [b for b in trunk_chain(skel) if b in s]
    if len(chain) < 3:
        return s
    sign = 1.0 if s[chain[-1]] >= s[chain[0]] else -1.0
    out = dict(s)
    cur = sign * s[chain[0]]
    for b in chain[1:]:
        cur = max(sign * s[b], cur + MIN_ANCHOR_GAP)
        out[b] = sign * cur
    return out


def muscle_weights(positions: np.ndarray, patches: list[Patch], skel: sk.Skeleton, bone_defs: dict[str, an.Bone],
                   fallback_body: str) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """-> (joint_index (n,2) into `bodies`, weights (n,2), bodies list). Joint indices refer to the returned list."""
    anchors, o_area, i_area = body_anchors(patches, skel, bone_defs)
    if not anchors:
        anchors = {fallback_body: positions.mean(0)}
    o = max(o_area, key=o_area.get) if o_area else next(iter(anchors))
    i = max(i_area, key=i_area.get) if i_area else next(iter(anchors))
    anchors.update(span_anchors(skel, o, i, set(anchors)))
    anchors.update(trunk_span_anchors(skel, anchors))
    bodies = list(anchors)
    n = len(positions)
    if len(bodies) == 1:
        return np.zeros((n, 2), np.int64), np.tile([1.0, 0.0], (n, 1)), bodies

    axis = anchors[i] - anchors[o]
    if np.linalg.norm(axis) < 1e-3:  # origin and insertion anchors coincide: use the spread of all anchors
        pts = np.array(list(anchors.values()))
        _, _, vt = np.linalg.svd(pts - pts.mean(0))
        axis = vt[0]
    u = axis / np.linalg.norm(axis)
    s_anchor = {b: float((a - anchors[o]) @ u) for b, a in anchors.items()}
    s_anchor = enforce_spine_order(skel, s_anchor)
    order = sorted(bodies, key=lambda b: s_anchor[b])
    s_sorted = np.array([s_anchor[b] for b in order])
    s = (positions - anchors[o]) @ u

    idx = np.clip(np.searchsorted(s_sorted, s, side="right") - 1, 0, len(order) - 1)
    nxt = np.minimum(idx + 1, len(order) - 1)
    span = np.maximum(s_sorted[nxt] - s_sorted[idx], 1e-6)
    t = np.where(nxt == idx, 0.0, smoothstep((s - s_sorted[idx]) / span))
    t = np.where(s < s_sorted[0], 0.0, t)
    pos_in = {b: k for k, b in enumerate(order)}  # joint index = position in `order`
    j = np.stack([idx, nxt], axis=1)
    w = np.stack([1 - t, t], axis=1)
    w[w < MIN_WEIGHT] = 0.0
    w /= w.sum(1, keepdims=True)
    assert len(pos_in) == len(order)
    return j.astype(np.int64), w, order


def skin_weights(skin_positions: np.ndarray, bone_vertices: dict[str, np.ndarray], tau: float = 0.02, k: int = 4) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Soft nearest-bone weights for the skin surface: w_b ~ exp(-(d_b - d_min) / tau), top-k per vertex."""
    bodies = list(bone_vertices)
    d = np.stack([cKDTree(bone_vertices[b]).query(skin_positions)[0] for b in bodies], axis=1)
    w = np.exp(-(d - d.min(1, keepdims=True)) / tau)
    top = np.argsort(-w, axis=1)[:, :k]
    wk = np.take_along_axis(w, top, axis=1)
    wk[wk < MIN_WEIGHT * wk.max(1, keepdims=True)] = 0.0
    wk /= wk.sum(1, keepdims=True)
    return top.astype(np.int64), wk, bodies


def to_skin_joint_arrays(j: np.ndarray, w: np.ndarray, local_bodies: list[str], all_bodies: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """Map local body indices to indices in the shared skin joint list and pad to 4 influences."""
    lut = np.array([all_bodies.index(b) for b in local_bodies], dtype=np.uint16)
    n, k = j.shape
    jj = np.zeros((n, 4), np.uint16)
    ww = np.zeros((n, 4), np.float32)
    jj[:, :k] = lut[j]
    ww[:, :k] = w
    ww /= ww.sum(1, keepdims=True)
    return jj, ww


def bodies_of_muscle_patches(res: MuscleResult) -> list[Patch]:
    return res.patches
