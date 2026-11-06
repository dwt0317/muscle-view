"""Golden vectors that pin the web viewer's kinematics to this package's.

Usage: python -m pipeline.golden     -> web/src/lib/kinematics.golden.json

For a few poses it records every body's local rotation (quaternion x, y, z, w) and the centroid of some posed meshes.
The unit test in web/src/lib/kinematics.test.ts and the Playwright test compare against it.
"""
from __future__ import annotations

import json

import numpy as np

from pipeline import anatomy as an
from pipeline import rig as rig_mod
from pipeline import scene as sc_mod
from pipeline import skeleton as sk
from pipeline.paths import ROOT

POSES = {
    "rest": {},
    "knee90": {"r_knee_flexion": 90},
    "hip_abd30_flex40": {"r_hip_abduction": 30, "r_hip_flexion": 40, "r_hip_rotation_int": 15},
    "shoulder": {"r_shoulder_abduction": 80, "r_shoulder_flexion": 30, "r_shoulder_rotation_int": -40,
                 "r_scapula_upward": 25, "r_clavicle_elevation": 8},
    "trunk": {"trunk_flexion": 35, "trunk_lateral": -20, "trunk_rotation": 25},
    "left_mirror": {"l_hip_abduction": 30, "l_shoulder_abduction": 80, "l_knee_flexion": 60, "l_shoulder_rotation_int": 20},
}
MESHES = ["b_tibia_r", "b_femur_l", "m_rectus_femoris_r", "m_deltoid_acromial_r", "m_erector_dummy"]


def rot_to_quat(r: np.ndarray) -> list[float]:
    """Rotation matrix -> quaternion (x, y, z, w), w >= 0."""
    t = np.trace(r)
    if t > 0:
        s = np.sqrt(t + 1) * 2
        q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, s / 4]
    else:
        i = int(np.argmax(np.diag(r)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = np.sqrt(1 + r[i, i] - r[j, j] - r[k, k]) * 2
        q = [0.0] * 4
        q[i] = s / 4
        q[j] = (r[j, i] + r[i, j]) / s
        q[k] = (r[k, i] + r[i, k]) / s
        q[3] = (r[k, j] - r[j, k]) / s
    q = np.array(q)
    return (q if q[3] >= 0 else -q).round(7).tolist()


RATIO_POSES = {
    "knee140": {"r_knee_flexion": 140},
    "hip_flex90": {"r_hip_flexion": 90},
    "shoulder_abd120": {"r_shoulder_abduction": 120, "r_scapula_upward": 30, "r_clavicle_elevation": 9},
    "trunk": {"trunk_flexion": 35, "trunk_lateral": -20, "trunk_rotation": 25},
}


def build() -> dict:
    a = an.load()
    sc = sc_mod.build()
    skel = sk.load()
    from pipeline import attachments as at
    from pipeline import joints as jt

    jt.compute_centers(a, skel)
    res, _ = at.run(sc, a, an.read_yaml("attachment_overrides.yaml"))
    rig = rig_mod.build_rig(sc, a, res, skel)
    out = {"poses": {}}
    for name, pose in POSES.items():
        quats = {bid: rot_to_quat(sk.body_rotation(skel, bid, pose)) for bid in skel.bodies}
        muscles, bones, _ = rig_mod.posed_geometry(rig, sc, pose)
        cents = {}
        for node in MESHES:
            if node.startswith("b_"):
                bid, s = node[2:].rsplit("_", 1)
                cents[node] = bones[(bid, s)].mean(0).round(5).tolist()
            elif node.startswith("m_") and "dummy" not in node:
                mid, s = node[2:].rsplit("_", 1)
                cents[node] = muscles[(mid, s)].mean(0).round(5).tolist()
        out["poses"][name] = {"pose": pose, "quaternions": quats, "centroids": cents}

    from pipeline import lengths as ln

    paths = ln.build_paths(a, res, skel)
    out["ratios"] = {}
    for name, pose in RATIO_POSES.items():
        r = ln.ratios(skel, paths, pose)
        out["ratios"][name] = {"pose": pose, "values": {f"{m}:{s}": round(v, 6) for (m, s), v in r.items()}}
    return out


def main() -> None:
    path = ROOT / "web" / "src" / "lib" / "kinematics.golden.json"
    path.write_text(json.dumps(build(), indent=1))
    print("wrote", path)


if __name__ == "__main__":
    main()
