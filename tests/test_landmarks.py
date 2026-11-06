import numpy as np
import pytest
import trimesh

from pipeline import anatomy as an
from pipeline import landmarks as lm
from pipeline import validate as v
from pipeline.paths import CACHE_DIR


def test_lateral_flips_with_side_and_fixed_axes_do_not():
    assert np.allclose(lm.axis_vector("lateral", "r"), [-1, 0, 0])  # patient right = -X
    assert np.allclose(lm.axis_vector("lateral", "l"), [1, 0, 0])
    assert np.allclose(lm.axis_vector("medial", "r"), [1, 0, 0])
    assert np.allclose(lm.axis_vector("anterior", "l"), [0, 0, 1])
    with pytest.raises(ValueError):
        lm.axis_vector("lateral", None)
    with pytest.raises(ValueError):
        lm.axis_vector("sideways", "r")


def test_dir_vector_is_normalised_and_combines_weights():
    d = lm.dir_vector({"anterior": 1, "superior": 1}, "r")
    assert np.isclose(np.linalg.norm(d), 1) and np.allclose(d, [0, 1, 1] / np.sqrt(2))
    with pytest.raises(ValueError):
        lm.dir_vector({"anterior": 1, "posterior": 1}, "r")


@pytest.fixture
def cloud():
    rng = np.random.default_rng(1)
    return rng.uniform(-1, 1, (500, 3))


def test_pick_extreme_finds_the_farthest_vertex(cloud):
    i = lm.pick_extreme(cloud, np.array([0, 1.0, 0]))
    assert cloud[i, 1] == cloud[:, 1].max()


def test_pick_extreme_respects_slab_and_midline(cloud):
    # only the lowest 20 % along Y, farthest towards +X
    i = lm.pick_extreme(cloud, np.array([1.0, 0, 0]), within={"axis": "superior", "frac": [0.0, 0.2]})
    assert cloud[i, 1] <= cloud[:, 1].min() + 0.2 * np.ptp(cloud[:, 1]) + 1e-9
    # midline: stay within +-8 mm of x=0
    pts = np.array([[0.2, 5, 0], [0.003, 1, 0], [-0.001, 2, 0]])
    j = lm.pick_extreme(pts, np.array([0, 1.0, 0]), midline=True)
    assert j == 2
    with pytest.raises(ValueError):
        lm.pick_extreme(pts[:1], np.array([0, 1.0, 0]), midline=True)


def test_projection_hits_the_skin_in_the_given_direction():
    skin = trimesh.creation.icosphere(subdivisions=4, radius=1.0)
    p, hit = lm.project_to_skin(skin, np.array([0.2, 0, 0]), np.array([1.0, 0, 0]))
    assert hit and np.allclose(p, [1, 0, 0], atol=0.02)
    # shooting the other way hits the opposite side, not the near one
    p2, _ = lm.project_to_skin(skin, np.array([0.2, 0, 0]), np.array([-1.0, 0, 0]))
    assert np.allclose(p2, [-1, 0, 0], atol=0.02)


def test_projection_falls_back_to_the_closest_point_when_the_ray_misses():
    skin = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    # origin outside the sphere, looking away: no hit ahead -> closest point on the surface
    p, hit = lm.project_to_skin(skin, np.array([3.0, 0, 0]), np.array([1.0, 0, 0]))
    assert not hit and np.allclose(p, [1, 0, 0], atol=0.05)


def _defs(**over):
    d = {"id": "x", "bone": "scapula", "dir": {"lateral": 1}, "regions": ["shoulder"],
         "name": {"zh": "a", "en": "b", "la": "c"}, "palpation": {"zh": "a", "en": "b"}}
    d.update(over)
    return [d]


@pytest.fixture
def anatomy():
    return an.load()


@pytest.mark.parametrize("over, needle", [
    ({"bone": "ghost"}, "unknown bone"),
    ({"dir": {"sideways": 1}}, "unknown direction"),
    ({"project": {"up": 1}}, "unknown direction"),
    ({"related": ["ghost_muscle"]}, "unknown muscle"),
    ({"regions": ["head"]}, "unknown region"),
    ({"midline": True}, "midline landmarks cannot use lateral"),
    ({"palpation": {"zh": "a", "en": ""}}, "missing palpation.en"),
])
def test_landmark_validation_errors(anatomy, over, needle):
    msgs = [str(i) for i in v.validate_landmarks(anatomy, _defs(**over))]
    assert any(needle in m for m in msgs), msgs


def test_landmark_validation_accepts_a_good_definition(anatomy):
    assert v.validate_landmarks(anatomy, _defs()) == []


@pytest.mark.skipif(not (CACHE_DIR / "za" / "index.json").exists(), reason="Z-Anatomy export not present")
def test_real_landmark_table_is_valid_and_asis_is_where_it_should_be(anatomy):
    defs = an.read_yaml("landmarks.yaml")["landmarks"]
    assert v.validate_landmarks(anatomy, defs) == []
    from pipeline import za

    skin = trimesh.creation.icosphere(subdivisions=3, radius=2.0)  # huge sphere: every ray hits it
    skin.apply_translation([0, 1.0, 0])
    res = {r["id"]: r for r in lm.compute(anatomy, [d for d in defs if d["id"] == "asis"], skin, za.index())}
    r, l = res["asis"]["items"]["r"], res["asis"]["items"]["l"]
    assert r["bonePos"][0] < -0.08 and l["bonePos"][0] > 0.08  # right = -X, left = +X
    assert 0.9 < r["bonePos"][1] < 1.05 and r["bonePos"][2] > 0  # pelvis height, anterior
    assert abs(r["bonePos"][0] + l["bonePos"][0]) < 0.01  # mirror symmetric
    assert {"sartorius", "tensor_fasciae_latae"} <= set(r["muscles"])
