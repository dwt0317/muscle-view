from types import SimpleNamespace

import numpy as np
import pytest
import trimesh

from pipeline import anatomy as an
from pipeline import attachments as at
from pipeline.meshops import MeshData
from pipeline.paths import CACHE_DIR

R = 0.1


def cylinder_x(half_len=1.0):
    """A muscle-like cylinder along X from -half_len to +half_len."""
    c = trimesh.creation.cylinder(radius=R, height=2 * half_len, sections=48)
    c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    return trimesh.Trimesh(c.vertices, c.faces, process=True).subdivide_to_size(0.03)


def block(x0, x1, y=0.5):
    b = trimesh.creation.box(bounds=[[x0, -y, -y], [x1, y, y]])
    return b.subdivide_to_size(0.03)


def muscle(origin_bones, insertion_bones, **kw):
    return an.Muscle(id="m", za="x", regions=["shoulder"], group="g", layer="deep", name={}, origin={}, insertion={},
                     origin_bones=origin_bones, insertion_bones=insertion_bones, function={}, **kw)


def bone_defs(*ids):
    return {i: an.Bone(id=i, sided=False, body="b", regions=[], name={}) for i in ids}


@pytest.fixture
def two_bones():
    return {("a", None): block(-1.3, -1.0), ("b", None): block(1.0, 1.3)}


def extract(m, mesh, bones, **kw):
    return at.extract_muscle(m, "r", mesh, bones, bone_defs(*{b for b, _ in bones}), **kw)


def test_both_ends_give_one_correctly_labelled_patch_each(two_bones):
    res = extract(muscle(["a"], ["b"]), cylinder_x(), two_bones)
    by = {(p.role, p.bone): p for p in res.patches}
    assert set(by) == {("origin", "a"), ("insertion", "b")}
    disk = np.pi * R * R * 1e4  # cm2
    for p in by.values():
        assert 0.7 * disk < p.area_cm2 < 1.7 * disk
    assert by[("origin", "a")].center[0] == pytest.approx(-1.0, abs=0.02)
    assert by[("insertion", "b")].center[0] == pytest.approx(1.0, abs=0.02)


def test_roles_follow_the_anatomy_table_not_geometry(two_bones):
    res = extract(muscle(["b"], ["a"]), cylinder_x(), two_bones)
    assert {(p.role, p.bone) for p in res.patches} == {("origin", "b"), ("insertion", "a")}


def test_a_bone_listed_for_both_roles_is_split_by_the_nearer_muscle_end():
    # "both" touches the muscle at each end; the origin-only bone "o" sits at the -X end
    both = trimesh.util.concatenate([block(-1.3, -1.0, 0.3), block(1.0, 1.3, 0.3)])
    bones = {("o", None): block(-1.6, -1.3), ("both", None): both}
    res = extract(muscle(["o", "both"], ["both"]), cylinder_x(), bones)
    roles = {(p.role, p.bone, round(float(p.center[0]))) for p in res.patches}
    assert ("origin", "both", -1) in roles  # near the origin end -> origin
    assert ("insertion", "both", 1) in roles  # near the other end -> insertion
    assert ("insertion", "both", -1) not in roles


def test_gap_widens_tau_and_notes_it():
    # a 6 mm gap: default tau (2.5 mm) finds nothing, the widening steps do
    bones = {("a", None): block(-1.306, -1.006), ("b", None): block(1.006, 1.306)}
    res = extract(muscle(["a"], ["b"]), cylinder_x(), bones)
    assert {p.role for p in res.patches} == {"origin", "insertion"}
    assert any("widened" in n for n in res.notes)


def test_explicit_tau_override_is_honoured_and_no_contact_is_reported():
    bones = {("a", None): block(-1.306, -1.006), ("b", None): block(1.4, 1.7)}  # b is far away
    res = extract(muscle(["a"], ["b"]), cylinder_x(), bones, tau_mm=8.0)
    assert [p.role for p in res.patches] == ["origin"]
    assert next(p for p in res.patches).tau_mm == 8.0
    assert any("insertion: no contact" in n for n in res.notes)


def test_tiny_contacts_are_ignored(two_bones):
    res = extract(muscle(["a"], ["b"]), cylinder_x(), two_bones, min_cluster_cm2=1e4)
    assert res.patches == []


def test_close_mask_fills_holes_and_cluster_faces_splits_disjoint_regions():
    s = trimesh.creation.icosphere(subdivisions=3)
    g = at.face_graph(s)
    mask = np.ones(len(s.faces), dtype=bool)
    mask[0] = False
    assert at.close_mask(g, mask, 1).all()

    z = s.triangles_center[:, 2]
    top, bottom = np.where(z > 0.8)[0], np.where(z < -0.8)[0]
    clusters = at.cluster_faces(s, np.r_[top, bottom], rings=1, min_area_m2=0)
    assert len(clusters) == 2
    assert sorted(len(c) for c in clusters) == sorted([len(top), len(bottom)])
    assert at.cluster_faces(s, np.array([], dtype=int), 1, 0) == []


def test_drop_override_removes_matching_clusters(two_bones):
    res = extract(muscle(["a"], ["b"]), cylinder_x(), two_bones)
    res = at.apply_override(res, {"drop": [{"role": "origin"}]}, two_bones, bone_defs("a", "b"))
    assert {p.role for p in res.patches} == {"insertion"}
    assert any("dropped" in n for n in res.notes)


def test_patch_meshes_float_above_the_bone_and_summary_has_node_names(two_bones):
    res = extract(muscle(["a"], ["b"]), cylinder_x(), two_bones)
    meshes = {k: trimesh.Trimesh(v.vertices, v.faces) for k, v in two_bones.items()}
    sc = SimpleNamespace(bones={k: MeshData(np.asarray(m.vertices, np.float32), np.asarray(m.vertex_normals, np.float32),
                                            np.asarray(m.faces, np.uint32)) for k, m in meshes.items()})
    groups = at.group_meshes(sc, [res])
    assert set(groups) == {"p_m_r_o_a", "p_m_r_i_b"}
    md, extras = groups["p_m_r_o_a"]
    assert extras["role"] == "origin" and extras["kind"] == "patch"
    # lifted by PATCH_LIFT_M along the vertex normals => strictly outside the bone's surface
    d = np.abs(trimesh.proximity.signed_distance(meshes[("a", None)], md.positions))
    assert d.min() == pytest.approx(at.PATCH_LIFT_M, abs=1e-4)
    summary = at.summarize([res])["m"]["r"]
    assert summary["origin"][0]["node"] == "p_m_r_o_a" and summary["insertion"][0]["bone"] == "b"


@pytest.mark.skipif(not (CACHE_DIR / "za" / "index.json").exists(), reason="Z-Anatomy export not present")
class TestRealData:
    @pytest.fixture(scope="class")
    @classmethod
    def run(cls):
        from pipeline import scene

        a = an.load()
        res, scores = at.run(scene.build(), a, an.read_yaml("attachment_overrides.yaml"), with_score=True)
        return a, {(r.muscle, r.side): r for r in res}, scores

    def test_every_muscle_has_origin_and_insertion_on_both_sides(self, run):
        a, res, _ = run
        for m in a.muscles:
            for s in an.SIDES:
                roles = {p.role for p in res[(m.id, s)].patches}
                assert roles == {"origin", "insertion"}, (m.id, s, roles, res[(m.id, s)].notes)

    def test_patches_are_on_the_documented_bones(self, run):
        a, res, _ = run
        for m in a.muscles:
            allowed = set(m.origin_bones) | set(m.insertion_bones)
            for p in res[(m.id, "r")].patches:
                assert p.bone in allowed, (m.id, p.bone)

    def test_supraspinatus_is_on_the_scapula_and_the_humerus(self, run):
        _, res, _ = run
        ps = res[("supraspinatus", "r")].patches
        origin = sum(p.area_cm2 for p in ps if p.role == "origin" and p.bone == "scapula")
        ins = sum(p.area_cm2 for p in ps if p.role == "insertion" and p.bone == "humerus")
        assert 15 < origin < 60 and 3 < ins < 25

    def test_left_and_right_are_mirror_images(self, run):
        _, res, _ = run
        r, l = res[("gluteus_medius", "r")], res[("gluteus_medius", "l")]
        cr = np.mean([p.center for p in r.patches if p.role == "origin"], axis=0)
        cl = np.mean([p.center for p in l.patches if p.role == "origin"], axis=0)
        assert cr[0] == pytest.approx(-cl[0], abs=0.01) and cr[1] == pytest.approx(cl[1], abs=0.01)

    def test_agreement_with_the_hand_drawn_decals_stays_reasonable(self, run):
        _, _, scores = run
        f1 = [s["f1"] for (m, side), s in scores.items() if side == "r" and s]
        assert len(f1) > 40 and np.mean(f1) > 0.5
