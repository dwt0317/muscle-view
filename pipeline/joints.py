"""Joint centres from the meshes (glTF world space, rest pose).

  centroid      centre of a Z-Anatomy joint mesh (intervertebral discs)
  sphere_fit    RANSAC sphere through the articular surface of a femoral / humeral head
  bone_extreme  end of a bone in an anatomical direction (sternal / acromial end of the clavicle)
  knee_axis     midpoint of the femoral epicondyles (flexion axis runs through them)
  same_as       copy another body's centre
"""
from __future__ import annotations

import numpy as np

from pipeline import anatomy as an
from pipeline import landmarks as lm
from pipeline import skeleton as sk
from pipeline import za


def solve_sphere(p: np.ndarray) -> tuple[np.ndarray, float] | None:
    """Exact sphere through 4 points (None if degenerate)."""
    a = np.hstack([2 * p, np.ones((4, 1))])
    b = (p**2).sum(1)
    try:
        x = np.linalg.solve(a, b)
    except np.linalg.LinAlgError:
        return None
    c = x[:3]
    r2 = x[3] + c @ c
    return (c, float(np.sqrt(r2))) if r2 > 0 else None


def fit_sphere_ransac(points: np.ndarray, r_range: tuple[float, float], thresh: float = 0.0015,
                      iters: int = 4000, seed: int = 0) -> tuple[np.ndarray, float, int]:
    """Largest sphere (radius within r_range) supported by the points; refined by least squares on its inliers."""
    rng = np.random.default_rng(seed)
    best: tuple[int, np.ndarray, float] | None = None
    n = len(points)
    for _ in range(iters):
        s = solve_sphere(points[rng.choice(n, 4, replace=False)])
        if s is None or not (r_range[0] <= s[1] <= r_range[1]):
            continue
        d = np.abs(np.linalg.norm(points - s[0], axis=1) - s[1])
        k = int((d < thresh).sum())
        if best is None or k > best[0]:
            best = (k, s[0], s[1])
    if best is None:
        raise ValueError("no sphere found in the radius range")
    for _ in range(3):  # least-squares refinement on the inliers
        d = np.abs(np.linalg.norm(points - best[1], axis=1) - best[2])
        inl = points[d < 2 * thresh]
        a = np.hstack([2 * inl, np.ones((len(inl), 1))])
        x, *_ = np.linalg.lstsq(a, (inl**2).sum(1), rcond=None)
        c = x[:3]
        r = float(np.sqrt(max(x[3] + c @ c, 1e-12)))
        if not (r_range[0] <= r <= r_range[1]):
            break
        best = (len(inl), c, r)
    return best[1], best[2], best[0]


def _bone_verts(a: an.Anatomy, bone_id: str, side: str | None, mesh: str | None, ix: dict) -> np.ndarray:
    return lm._bone_vertices(a.bone(bone_id), side, mesh, ix)


def compute_center(a: an.Anatomy, body: sk.Body, spec: dict, centers: dict[str, np.ndarray], ix: dict) -> np.ndarray:
    t = spec["type"]
    side = body.side
    if t == "centroid":
        return za.za_to_gltf(za.load_mesh(spec["mesh"]).vertices).mean(0)
    if t == "bone_extreme":
        v = _bone_verts(a, spec["bone"], side, spec.get("mesh"), ix)
        return v[lm.pick_extreme(v, lm.dir_vector(spec["dir"], side), side=side)]
    if t == "sphere_fit":
        v = _bone_verts(a, spec["bone"], side, spec.get("mesh"), ix)
        top = v[v[:, 1] >= np.quantile(v[:, 1], 0.88)]  # the head sits at the proximal end
        c, _, _ = fit_sphere_ransac(top, tuple(x / 1000 for x in spec["radius_mm"]))
        return c
    if t == "knee_axis":
        v = _bone_verts(a, spec["bone"], side, None, ix)
        lo = {"axis": "superior", "frac": [0.0, 0.2]}
        p_lat = v[lm.pick_extreme(v, lm.dir_vector({"lateral": 1}, side), within=lo, side=side)]
        p_med = v[lm.pick_extreme(v, lm.dir_vector({"medial": 1}, side), within=lo, side=side)]
        return (p_lat + p_med) / 2
    if t == "same_as":
        return centers[spec["body"]]
    raise ValueError(f"unknown joint centre type {t!r}")


def compute_centers(a: an.Anatomy, skel: sk.Skeleton, ix: dict | None = None) -> dict[str, np.ndarray]:
    ix = ix or za.index()
    centers: dict[str, np.ndarray] = {}
    for bid, b in skel.bodies.items():
        if b.parent is None:
            centers[bid] = np.zeros(3)  # root: world origin (the pelvis does not move)
        else:
            centers[bid] = compute_center(a, b, b.spec, centers, ix)
        b.center = centers[bid]
    return centers
