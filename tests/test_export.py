import numpy as np
import pytest
import trimesh
from pygltflib import GLTF2

from pipeline import anatomy as an
from pipeline import export as ex
from pipeline import meshops as mo
from pipeline import za
from pipeline.gltf_writer import GltfBuilder
from pipeline.paths import BUILD_DIR, CACHE_DIR


def test_za_to_gltf_is_proper_rotation_with_expected_axes():
    # Z-Anatomy: +Z up, anterior = -Y, patient right = -X.
    up = za.za_to_gltf([0, 0, 1])
    front = za.za_to_gltf([0, -1, 0])
    right = za.za_to_gltf([-1, 0, 0])
    assert np.allclose(up, [0, 1, 0])        # glTF up
    assert np.allclose(front, [0, 0, 1])     # glTF anterior = +Z
    assert np.allclose(right, [-1, 0, 0])    # x is untouched
    m = np.array([za.za_to_gltf(e) for e in np.eye(3)])
    assert np.isclose(np.linalg.det(m), 1.0)  # no mirroring


def test_simplify_reduces_faces_and_keeps_shape():
    sphere = trimesh.creation.icosphere(subdivisions=5, radius=0.1)
    out = mo.simplify(sphere, 500)
    assert 300 <= len(out.faces) <= 700
    assert np.allclose(out.bounds, sphere.bounds, atol=0.006)
    assert mo.simplify(sphere, 10**7) is sphere  # already small enough: untouched


def test_budget_is_clamped():
    assert mo.budget(100, ratio=0.3) == 100          # never above source
    assert mo.budget(10000, ratio=0.01, lo=250) == 250
    assert mo.budget(10**6, ratio=0.5, hi=5000) == 5000


def test_to_gltf_outputs_matching_arrays():
    box = trimesh.creation.box(extents=[1, 2, 3])
    d = mo.to_gltf(box)
    assert d.positions.dtype == np.float32 and d.indices.dtype == np.uint32
    assert d.positions.shape == d.normals.shape
    assert np.allclose(np.linalg.norm(d.normals, axis=1), 1, atol=1e-4)
    # z-extent (3) becomes y-extent in glTF space
    assert np.isclose(np.ptp(d.positions[:, 1]), 3)


def test_shell_from_gappy_surface_patches_is_watertight_with_right_volume():
    # A sphere surface cut into two halves with a thin gap (a slit) between them.
    r = 0.1
    ball = trimesh.creation.icosphere(subdivisions=4, radius=r)
    z = ball.triangles_center[:, 2]
    upper = ball.submesh([np.where(z > 0.003)[0]], append=True)
    lower = ball.submesh([np.where(z < -0.003)[0]], append=True)
    shell = mo.shell_from_surfaces([upper, lower], pitch=0.004, sigma=0.8, close_iters=2)
    assert shell.is_watertight
    expected = 4 / 3 * np.pi * r**3
    assert 0.85 * expected < shell.volume < 1.1 * expected
    assert shell.volume > 0  # outward-facing normals


def test_gltf_writer_roundtrip_with_skin(tmp_path):
    g = GltfBuilder()
    mat = g.material("m", (1, 0, 0, 1))
    root = g.node("model")
    j0 = g.node("j0", root, translation=[0, 1, 0])
    j1 = g.node("j1", j0, translation=[0, 1, 0])
    box = mo.to_gltf(trimesh.creation.box(extents=[1, 1, 1]))
    n = len(box.positions)
    box.joints = np.zeros((n, 4), np.uint16)
    box.joints[:, 1] = 1
    box.weights = np.tile(np.array([0.5, 0.5, 0, 0], np.float32), (n, 1))
    ibm = np.stack([np.eye(4), np.eye(4)])
    skin = g.skin([j0, j1], ibm)
    g.mesh_node("m_test_r", box, mat, root, extras={"kind": "muscle"}, skin=skin)
    out = tmp_path / "t.glb"
    g.save(out)
    back = GLTF2().load_binary(str(out))
    names = [x.name for x in back.nodes]
    assert names == ["model", "j0", "j1", "m_test_r"]
    assert back.nodes[3].skin == 0 and back.nodes[3].extras == {"kind": "muscle"}
    assert back.skins[0].joints == [1, 2]
    prim = back.meshes[0].primitives[0]
    assert prim.attributes.JOINTS_0 is not None and prim.attributes.WEIGHTS_0 is not None


@pytest.mark.skipif(not (BUILD_DIR / "model_raw.glb").exists() or not (CACHE_DIR / "za" / "index.json").exists(),
                    reason="run python -m pipeline.export first")
def test_exported_nodes_match_yaml_manifest_patches_and_skeleton():
    import json

    from pipeline import skeleton as sk
    from pipeline.paths import WEB_DATA_DIR

    a = an.load()
    skel = sk.load()
    expected = {"model", "skin"}
    expected |= {m.node(s) for m in a.muscles for s in an.SIDES}
    expected |= {b.node(s) for b in a.bones for s in b.sides()}
    expected |= {f"j_{bid}" for bid in skel.bodies}
    manifest = json.loads((WEB_DATA_DIR / "manifest.json").read_text())
    patch_nodes = {
        f"p_{mid}_{side}_{'o' if role == 'origin' else 'i'}_{p['bone']}"
        for mid, sides in manifest["attachments"].items()
        for side, d in sides.items()
        for role in ("origin", "insertion")
        for p in d[role]
    }
    back = GLTF2().load_binary(str(BUILD_DIR / "model_raw.glb"))
    got = [n.name for n in back.nodes]
    assert len(got) == len(set(got)), "duplicate node names"
    assert set(got) == expected | patch_nodes
    assert len(patch_nodes) > 300

    by_name = {n.name: i for i, n in enumerate(back.nodes)}
    # joint hierarchy mirrors the skeleton, and the skin lists every joint in skeleton order
    for bid, body in skel.bodies.items():
        if body.parent:
            assert by_name[f"j_{bid}"] in back.nodes[by_name[f"j_{body.parent}"]].children
    assert [back.nodes[j].name for j in back.skins[0].joints] == [f"j_{b}" for b in skel.bodies]
    # muscles and skin are skinned; bones and patches are rigid children of a joint
    for m in a.muscles:
        assert back.nodes[by_name[m.node("r")]].skin == 0
    assert back.nodes[by_name["skin"]].skin == 0
    joint_children = {c for n in back.nodes if n.name.startswith("j_") for c in n.children}
    for name in expected | patch_nodes:
        if name.startswith(("b_", "p_")):
            assert by_name[name] in joint_children, name
            assert back.nodes[by_name[name]].skin is None
    # every node except the root and the joints carries a mesh
    assert all(n.mesh is not None for n in back.nodes if n.name != "model" and not n.name.startswith("j_"))


def test_manifest_lists_every_muscle_node():
    a = an.load()
    mf = ex.build_manifest(a)
    assert len(mf["muscles"]) == len(a.muscles)
    first = mf["muscles"][0]
    assert set(first["nodes"]) == {"r", "l"} and first["name"]["la"].startswith("M.")
    assert "CC Attribution-Share Alike 2.1 Japan" in mf["attribution"][0]
