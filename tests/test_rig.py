import numpy as np
import pytest

from pipeline import anatomy as an
from pipeline import joints as jt
from pipeline import skeleton as sk
from pipeline import skinning as sn
from pipeline.attachments import Patch
from pipeline.paths import CACHE_DIR

# --------------------------------------------------------------------------- sphere fitting


def sphere_points(center, radius, n=1500, noise=0.0004, cap=None, seed=0):
    rng = np.random.default_rng(seed)
    v = rng.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    if cap is not None:  # keep only a cap around +Y, like an articular surface
        v = v[v[:, 1] > cap]
    return np.asarray(center) + radius * v + rng.normal(scale=noise, size=v.shape)


def test_solve_sphere_is_exact_for_four_points():
    c, r = np.array([0.1, -0.2, 0.3]), 0.05
    p = sphere_points(c, r, 4, noise=0)
    got_c, got_r = jt.solve_sphere(p)
    assert np.allclose(got_c, c, atol=1e-9) and got_r == pytest.approx(r)


def test_ransac_recovers_a_noisy_sphere_cap_and_ignores_outliers():
    c, r = np.array([-0.08, 0.86, -0.005]), 0.024
    pts = sphere_points(c, r, cap=0.3)
    rng = np.random.default_rng(3)
    outliers = c + rng.uniform(-0.06, 0.06, size=(250, 3))  # greater trochanter, neck, ... anything not on the sphere
    centre, radius, inliers = jt.fit_sphere_ransac(np.vstack([pts, outliers]), (0.018, 0.032))
    assert np.linalg.norm(centre - c) < 0.0012  # within ~1 mm
    assert radius == pytest.approx(r, abs=0.0015)
    assert inliers > 0.8 * len(pts)


def test_ransac_refuses_when_no_sphere_has_the_required_radius():
    pts = sphere_points([0, 0, 0], 0.1)
    with pytest.raises(ValueError):
        jt.fit_sphere_ransac(pts, (0.01, 0.02), iters=300)


# --------------------------------------------------------------------------- skeleton


@pytest.fixture(scope="module")
def skel():
    s = sk.load()
    # synthetic joint centres so the tests do not depend on the meshes
    ys = {"pelvis": 0.0, "l5": 0.96, "l4": 1.0, "l3": 1.03, "l2": 1.07, "l1": 1.10, "thorax": 1.13}
    for b in s.bodies.values():
        if b.id in ys:
            b.center = np.array([0.0, ys[b.id], 0.0])
        else:
            sign = -1 if b.side == "r" else 1
            base = {"clavicle": (0.01, 1.40, 0.03), "scapula": (0.15, 1.42, -0.03), "humerus": (0.17, 1.38, -0.03),
                    "femur": (0.08, 0.86, 0.0), "tibia": (0.07, 0.46, -0.03), "patella": (0.07, 0.46, -0.03)}[b.id.split(".")[0]]
            b.center = np.array([sign * base[0], base[1], base[2]])
    return s


def test_structure_and_mirroring(skel):
    assert skel.bodies["humerus.r"].parent == "scapula.r" and skel.bodies["patella.l"].parent == "femur.l"
    r, l = skel.bodies["humerus.r"].dofs[0], skel.bodies["humerus.l"].dofs[0]
    assert np.allclose(r.axis, [0, 0, 1]) and np.allclose(l.axis, [0, 0, -1])  # z flips for the left side
    assert skel.bodies["tibia.l"].dofs[0].axis.tolist() == skel.bodies["tibia.r"].dofs[0].axis.tolist()  # x does not
    assert skel.path("scapula.r", "femur.r")[:3] == ["scapula.r", "clavicle.r", "thorax"]
    for d in skel.trunk_dofs:
        assert sum(d["shares"].values()) == pytest.approx(1)


def test_rest_pose_is_identity(skel):
    for m in sk.skin_matrices(skel, {}).values():
        assert np.allclose(m, np.eye(4), atol=1e-12)


def test_knee_flexion_moves_the_shank_backwards_and_keeps_the_knee_centre_fixed(skel):
    mats = sk.skin_matrices(skel, {"r_knee_flexion": 90})
    knee = skel.bodies["tibia.r"].center
    assert np.allclose(sk.apply(mats, "tibia.r", knee[None])[0], knee)  # the joint centre does not move
    ankle = knee + np.array([0, -0.4, 0])
    moved = sk.apply(mats, "tibia.r", ankle[None])[0] - knee
    assert np.allclose(moved, [0, 0, -0.4], atol=1e-9)  # straight back
    assert np.allclose(sk.apply(mats, "femur.r", ankle[None])[0], ankle)  # thigh unaffected


def test_hip_flexion_carries_the_whole_leg(skel):
    mats = sk.skin_matrices(skel, {"r_hip_flexion": 90})
    hip, knee = skel.bodies["femur.r"].center, skel.bodies["tibia.r"].center
    k2 = sk.apply(mats, "tibia.r", knee[None])[0]
    assert np.linalg.norm(k2 - hip) == pytest.approx(np.linalg.norm(knee - hip))  # rigid
    assert (k2 - hip)[2] > 0.3  # the knee comes forward


def test_left_pose_keys_mirror_the_right_ones(skel):
    r = sk.skin_matrices(skel, {"r_hip_abduction": 30})["femur.r"]
    l = sk.skin_matrices(skel, {"l_hip_abduction": 30})["femur.l"]
    foot_r = skel.bodies["femur.r"].center + [0, -0.8, 0]
    foot_l = skel.bodies["femur.l"].center + [0, -0.8, 0]
    pr = (r[:3, :3] @ foot_r + r[:3, 3])
    pl = (l[:3, :3] @ foot_l + l[:3, 3])
    assert pr[0] < foot_r[0] and pl[0] > foot_l[0]  # right leg goes to -X, left leg to +X
    assert pr[0] - foot_r[0] == pytest.approx(-(pl[0] - foot_l[0]))


def test_trunk_flexion_is_shared_and_sums_to_the_requested_angle(skel):
    pose = {"trunk_flexion": 40}
    total = np.zeros(3)
    for bid in ("l5", "l4", "l3", "l2", "l1", "thorax"):
        r = sk.body_rotation(skel, bid, pose)
        total += [np.arctan2(r[2, 1], r[2, 2]), 0, 0]  # rotation about x
    assert np.degrees(total[0]) == pytest.approx(40, abs=1e-6)
    # upper body goes forward
    mats = sk.skin_matrices(skel, pose)
    head = np.array([0.0, 1.6, 0.0])
    assert sk.apply(mats, "thorax", head[None])[0][2] > 0.1


def test_unknown_or_unbalanced_trunk_shares_are_rejected():
    doc = an.read_yaml("skeleton.yaml")
    doc["trunk_dofs"][0]["shares"] = {"l5": 0.5, "thorax": 0.2}
    with pytest.raises(ValueError):
        sk.load(doc)
    doc = an.read_yaml("skeleton.yaml")
    doc["trunk_dofs"][0]["shares"] = {"femur.r": 1.0}
    with pytest.raises(ValueError):
        sk.load(doc)


# --------------------------------------------------------------------------- skin weights


def test_smoothstep_is_clamped_and_symmetric():
    t = np.array([-1, 0, 0.5, 1, 2.0])
    assert sn.smoothstep(t).tolist() == [0, 0, 0.5, 1, 1]


def patch(role, body_bone, center, area=1e-3, side="r"):
    return Patch("m", side, role, body_bone, side, np.array([0]), area, np.array(center, float), 2.5)


def test_two_segment_weights_are_1_at_the_origin_end_0_at_the_insertion_end_and_blend_between(skel):
    bone_defs = {"femur": an.Bone("femur", True, "femur", [], {}), "tibia": an.Bone("tibia", True, "tibia", [], {})}
    patches = [patch("origin", "femur", [-0.08, 0.80, 0]), patch("insertion", "tibia", [-0.07, 0.40, 0])]
    pos = np.array([[-0.08, y, 0.0] for y in (0.90, 0.80, 0.60, 0.50, 0.40, 0.30)])
    j, w, order = sn.muscle_weights(pos, patches, skel, bone_defs, "femur.r")
    jj, ww = sn.to_skin_joint_arrays(j, w, order, list(skel.bodies))
    names = list(skel.bodies)
    top = {names[jj[0, k]]: ww[0, k] for k in range(4) if ww[0, k] > 0}
    bottom = {names[jj[-1, k]]: ww[-1, k] for k in range(4) if ww[-1, k] > 0}
    assert top == {"femur.r": pytest.approx(1.0)}  # above the origin anchor: follows the thigh
    assert bottom == {"tibia.r": pytest.approx(1.0)}  # below the insertion anchor: follows the shank
    mid = {names[jj[3, k]]: ww[3, k] for k in range(4) if ww[3, k] > 0}
    assert set(mid) <= {"femur.r", "tibia.r"} and sum(mid.values()) == pytest.approx(1.0)
    assert np.allclose(ww.sum(1), 1)


def test_a_muscle_with_a_single_body_follows_it_rigidly(skel):
    bone_defs = {"scapula": an.Bone("scapula", True, "scapula", [], {})}
    patches = [patch("origin", "scapula", [-0.12, 1.3, -0.1]), patch("insertion", "scapula", [-0.14, 1.3, -0.08])]
    pos = np.random.default_rng(0).uniform(-0.1, 0.1, (50, 3)) + [-0.13, 1.3, -0.09]
    j, w, order = sn.muscle_weights(pos, patches, skel, bone_defs, "scapula.r")
    assert order == ["scapula.r"] and np.allclose(w[:, 0], 1)


def test_the_spine_between_pelvis_and_thorax_shares_a_trunk_muscle(skel):
    bone_defs = {"hip_bone": an.Bone("hip_bone", True, "pelvis", [], {}), "ribs": an.Bone("ribs", True, "thorax", [], {})}
    patches = [patch("origin", "hip_bone", [-0.05, 0.98, -0.06]), patch("insertion", "ribs", [-0.06, 1.25, -0.08])]
    pos = np.array([[-0.05, y, -0.07] for y in np.linspace(0.9, 1.3, 40)])
    j, w, order = sn.muscle_weights(pos, patches, skel, bone_defs, "pelvis")
    assert {"l5", "l4", "l3", "l2", "l1"} <= set(order)  # every lumbar level takes part
    # no vertex pair that is close in space may be blended with very different bodies: weights change gradually
    primary = np.array([order[k] for k in j[np.arange(len(j)), np.argmax(w, 1)]])
    assert len(set(primary)) >= 4


def test_enforced_spine_order_keeps_a_minimum_gap(skel):
    s = {"pelvis": 0.0, "l5": 0.001, "l4": 0.002, "thorax": 0.003}
    out = sn.enforce_spine_order(skel, s)
    vals = [out[b] for b in ("pelvis", "l5", "l4", "thorax")]
    assert all(b - a >= sn.MIN_ANCHOR_GAP - 1e-12 for a, b in zip(vals, vals[1:]))


def test_skin_weights_pick_the_nearest_body_and_sum_to_one():
    bones = {"a": np.array([[0, 0, 0.0], [0, 0.1, 0]]), "b": np.array([[1, 0, 0.0], [1, 0.1, 0]]), "c": np.array([[5, 5, 5.0]])}
    pts = np.array([[0.01, 0.02, 0], [0.99, 0.05, 0], [0.5, 0.05, 0]])
    j, w, bodies = sn.skin_weights(pts, bones)
    assert np.allclose(w.sum(1), 1)
    assert bodies[j[0, 0]] == "a" and bodies[j[1, 0]] == "b"
    assert w[0, 0] > 0.9 and w[1, 0] > 0.9
    assert abs(w[2, 0] - w[2, 1]) < 0.05  # halfway between a and b


# --------------------------------------------------------------------------- real data


@pytest.mark.skipif(not (CACHE_DIR / "za" / "index.json").exists(), reason="Z-Anatomy export not present")
def test_real_joint_centres_are_anatomically_plausible():
    from pipeline import za

    a = an.load()
    s = sk.load()
    c = jt.compute_centers(a, s)

    def mesh_centre(name):
        return za.za_to_gltf(za.load_mesh(name).vertices).mean(0)

    # the hip centre is within 10 mm of the acetabular labrum, the glenohumeral centre within 15 mm of the capsule
    assert np.linalg.norm(c["femur.r"] - mesh_centre("Acetabular labrum.r")) < 0.010
    assert np.linalg.norm(c["humerus.r"] - mesh_centre("Articular capsule of glenohumeral joint.r")) < 0.015
    # left/right symmetry within 5 mm (mirror in X)
    for name in ("femur", "tibia", "humerus", "scapula", "clavicle"):
        r, l = c[f"{name}.r"], c[f"{name}.l"]
        assert abs(r[0] + l[0]) < 0.005 and abs(r[1] - l[1]) < 0.005 and abs(r[2] - l[2]) < 0.005
    # vertical order of the spine and limb joints
    assert c["l5"][1] < c["l4"][1] < c["l3"][1] < c["l2"][1] < c["l1"][1] < c["thorax"][1]
    assert c["tibia.r"][1] < c["femur.r"][1] < c["pelvis"][1] + 1.0
    assert 0.35 < c["tibia.r"][1] < 0.55  # knee height of an adult male
