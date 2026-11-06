import copy

import numpy as np
import pytest

from pipeline import anatomy as an
from pipeline import lengths as ln
from pipeline import motions as mo
from pipeline import skeleton as sk
from pipeline.paths import CACHE_DIR


@pytest.fixture(scope="module")
def ctx():
    return an.load(), sk.load(), mo.load()


def issues(ctx, motions):
    a, skel, _ = ctx
    return [str(i) for i in mo.validate(motions, a, skel)]


def test_the_shipped_motion_table_is_valid(ctx):
    assert issues(ctx, ctx[2]) == []


def test_every_region_has_motions_and_the_requested_counts(ctx):
    by_region = {}
    for m in ctx[2]:
        by_region.setdefault(m["region"], []).append(m["id"])
    assert set(by_region) == {"shoulder", "hip", "knee", "lumbar"}
    assert all(2 <= len(v) <= 3 or v == ["knee_flexion"] for v in by_region.values())  # 2-3 core motions per region
    assert len(ctx[2]) == 9


def test_shoulder_abduction_follows_the_scapulohumeral_rhythm(ctx):
    m = next(x for x in ctx[2] if x["id"] == "shoulder_abduction")
    assert mo.interpolate(m, 0)["r_scapula_upward"] == 0
    assert mo.interpolate(m, 30)["r_scapula_upward"] == 0  # first 30 degrees: glenohumeral only
    # beyond 30 degrees the scapula takes 1 of every 3 degrees (2:1 rhythm)
    for angle in (60, 90, 150, 180):
        scap = mo.interpolate(m, angle)["r_scapula_upward"]
        assert scap == pytest.approx((angle - 30) / 3, abs=0.5)
    # the humerothoracic angle is the parameter itself
    assert mo.interpolate(m, 123)["r_shoulder_abduction"] == pytest.approx(123)


def test_interpolation_is_linear_and_clamped(ctx):
    m = next(x for x in ctx[2] if x["id"] == "knee_flexion")
    assert mo.interpolate(m, 70) == {"r_knee_flexion": pytest.approx(70)}
    assert mo.interpolate(m, -50) == {"r_knee_flexion": 0}
    assert mo.interpolate(m, 900) == {"r_knee_flexion": 140}


def test_direction_follows_the_sign_of_the_parameter(ctx):
    flex = next(x for x in ctx[2] if x["id"] == "shoulder_flexion")
    assert mo.direction_for(flex, 40) == "pos" and mo.direction_for(flex, -10) == "neg"
    knee = next(x for x in ctx[2] if x["id"] == "knee_flexion")
    assert mo.direction_for(knee, 0) == "pos"


def test_side_tags_resolve_for_limb_and_trunk_motions():
    assert mo.resolve_role_entry("gluteus_medius", "right", None) == [("gluteus_medius", "r")]
    assert mo.resolve_role_entry("external_oblique@ipsi", "trunk", "r") == [("external_oblique", "r")]
    assert mo.resolve_role_entry("external_oblique@contra", "trunk", "r") == [("external_oblique", "l")]
    assert mo.resolve_role_entry("external_oblique@contra", "trunk", "l") == [("external_oblique", "r")]
    assert sorted(mo.resolve_role_entry("rectus_abdominis", "trunk", None)) == [("rectus_abdominis", "l"), ("rectus_abdominis", "r")]


@pytest.mark.parametrize("mutate, needle", [
    (lambda m: m[0].update(region="head"), "unknown region"),
    (lambda m: m[0].update(limb="left"), "limb must be"),
    (lambda m: m[0]["keyframes"][0]["pose"].update(r_nonsense=3), "different set of pose keys"),
    (lambda m: m[0]["keyframes"][1].update(at=0), "strictly increasing"),
    (lambda m: m[0]["keyframes"].pop(), "span the whole parameter range"),
    (lambda m: m[0]["directions"]["pos"]["roles"]["agonist"].append("ghost_muscle"), "unknown muscle"),
    (lambda m: m[0]["directions"]["pos"]["roles"]["antagonist"].append("deltoid_acromial"), "both agonist and antagonist"),
    (lambda m: m[0]["directions"]["pos"]["roles"]["agonist"].append("deltoid_clavicular@ipsi"), "only apply to trunk"),
    (lambda m: m[0]["directions"]["pos"]["roles"].update(antagonist=[]), "at least one antagonist"),
    (lambda m: m[0]["param"].update(min=-10), "no 'neg' direction"),
    (lambda m: m[0]["play"].__setitem__(1, 999), "play range"),
    (lambda m: m[0]["keyframes"][0]["pose"].clear(), "different set of pose keys"),
])
def test_validation_errors(ctx, mutate, needle):
    motions = copy.deepcopy(ctx[2])
    mutate(motions)
    msgs = issues(ctx, motions)
    assert any(needle in m for m in msgs), msgs


def test_trunk_side_motions_need_a_direction_side(ctx):
    motions = copy.deepcopy(ctx[2])
    lat = next(m for m in motions if m["id"] == "trunk_lateral")
    del lat["directions"]["pos"]["ipsi"]
    assert any("ipsi" in m for m in issues(ctx, motions))


# --------------------------------------------------------------------------- biomechanical consistency (real data)
needs_data = pytest.mark.skipif(not (CACHE_DIR / "za" / "index.json").exists(), reason="Z-Anatomy export not present")


@pytest.fixture(scope="module")
def paths():
    from pipeline import attachments as at
    from pipeline import joints as jt
    from pipeline import scene as sc_mod

    a = an.load()
    skel = sk.load()
    jt.compute_centers(a, skel)
    res, _ = at.run(sc_mod.build(), a, an.read_yaml("attachment_overrides.yaml"))
    return skel, ln.build_paths(a, res, skel)


def ratio_at(paths, motion_id, value, muscle, side="r"):
    skel, p = paths
    m = next(x for x in mo.load() if x["id"] == motion_id)
    return ln.ratios(skel, p, mo.interpolate(m, value))[(muscle, side)]


@needs_data
def test_rest_pose_gives_ratio_one_for_every_muscle(paths):
    skel, p = paths
    assert all(v == pytest.approx(1.0) for v in ln.ratios(skel, p, {}).values())


@needs_data
@pytest.mark.parametrize("motion, value, shortens, lengthens", [
    # knee flexion: hamstrings shorten, quadriceps lengthen
    ("knee_flexion", 140, ["semitendinosus", "semimembranosus", "biceps_femoris_long", "sartorius"],
     ["rectus_femoris", "vastus_lateralis", "vastus_medialis", "vastus_intermedius"]),
    # hip flexion: flexors shorten, extensors lengthen
    ("hip_flexion", 90, ["iliacus", "rectus_femoris", "sartorius", "tensor_fasciae_latae"],
     ["gluteus_maximus", "semitendinosus", "biceps_femoris_long", "adductor_magnus"]),
    ("hip_flexion", -20, ["gluteus_maximus"], ["iliacus"]),
    ("hip_abduction", 45, ["gluteus_medius", "gluteus_minimus", "tensor_fasciae_latae"], ["adductor_longus", "adductor_magnus", "gracilis"]),
    ("hip_abduction", -30, ["adductor_longus"], ["gluteus_medius", "tensor_fasciae_latae"]),
    # shoulder abduction: deltoid / supraspinatus shorten, latissimus / teres major / pectoralis lengthen
    ("shoulder_abduction", 90, ["deltoid_acromial", "supraspinatus"], ["latissimus_dorsi", "teres_major", "pectoralis_major_sternocostal"]),
    ("shoulder_flexion", 90, ["deltoid_clavicular", "coracobrachialis"], ["deltoid_spinal", "latissimus_dorsi", "teres_major"]),
    ("shoulder_flexion", -60, ["deltoid_spinal"], ["pectoralis_major_clavicular"]),
    ("shoulder_rotation", 70, ["subscapularis"], ["infraspinatus", "teres_minor"]),
    ("shoulder_rotation", -70, ["infraspinatus", "teres_minor"], ["subscapularis"]),
    ("trunk_flexion", 50, ["rectus_abdominis", "internal_oblique"], ["iliocostalis_lumborum", "longissimus_thoracis", "multifidus_lumborum"]),
    ("trunk_flexion", -25, ["iliocostalis_lumborum", "longissimus_thoracis"], ["rectus_abdominis"]),
])
def test_shortening_and_lengthening_match_the_expected_anatomy(paths, motion, value, shortens, lengthens):
    for mid in shortens:
        assert ratio_at(paths, motion, value, mid) < 0.97, (motion, value, mid)
    for mid in lengthens:
        assert ratio_at(paths, motion, value, mid) > 1.03, (motion, value, mid)


@needs_data
def test_trunk_side_bending_shortens_the_ipsilateral_side_and_lengthens_the_contralateral(paths):
    for mid in ("quadratus_lumborum", "external_oblique", "internal_oblique", "iliocostalis_lumborum"):
        right = ratio_at(paths, "trunk_lateral", 30, mid, "r")  # bending to the right
        left = ratio_at(paths, "trunk_lateral", 30, mid, "l")
        assert right < 0.97 and left > 1.03, (mid, right, left)
        # and the mirror image for the opposite direction
        assert ratio_at(paths, "trunk_lateral", -30, mid, "l") < 0.97


@needs_data
def test_limb_motions_do_not_change_the_other_limb(paths):
    for motion, value, mid in (("knee_flexion", 140, "semitendinosus"), ("hip_flexion", 90, "iliacus"),
                               ("shoulder_abduction", 120, "deltoid_acromial")):
        assert ratio_at(paths, motion, value, mid, "l") == pytest.approx(1.0)


@needs_data
def test_agonists_are_not_stretched_in_the_mid_range_of_limb_motions(paths):
    """The role tables are only trustworthy if the rig agrees: at the middle of each limb motion, no agonist may be
    clearly lengthened. (Beyond ~120 degrees of shoulder elevation a straight-line path no longer describes the muscle
    well, which is why the check is done at the middle of the range, and why the UI says the colouring is schematic.)"""
    skel, p = paths
    bad = []
    for m in mo.load():
        if m["limb"] != "right":
            continue
        for dname, d in m["directions"].items():
            lo, hi = m["param"]["min"], m["param"]["max"]
            value = min(hi, 90) if dname == "pos" else max(lo, -45)
            r = ln.ratios(skel, p, mo.interpolate(m, value))
            for entry in d["roles"]["agonist"]:
                mid = entry.partition("@")[0]
                if r[(mid, "r")] > 1.05:
                    bad.append((m["id"], dname, mid, round(r[(mid, "r")], 2)))
    assert bad == [], bad
