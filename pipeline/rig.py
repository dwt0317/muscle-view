"""The rig: skeleton with joint centres + skin weights for every muscle and the skin, and posing helpers.

Used by export.py (skinned glb), the tests, and the Blender previews.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import trimesh

from pipeline import anatomy as an
from pipeline import joints as jt
from pipeline import skeleton as sk
from pipeline import skinning as sn
from pipeline.attachments import MuscleResult
from pipeline.meshops import MeshData


@dataclass
class Rig:
    skel: sk.Skeleton
    joint_names: list[str]  # skin joint order == skeleton body order
    muscle_skin: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]]  # (id, side) -> joints (n,4), weights (n,4)
    skin_skin: tuple[np.ndarray, np.ndarray]
    bone_body: dict[tuple[str, str | None], str]

    def center(self, body: str) -> np.ndarray:
        return self.skel.bodies[body].center


def build_rig(sc, a: an.Anatomy, att_results: list[MuscleResult], skel: sk.Skeleton | None = None) -> Rig:
    skel = skel or sk.load()
    jt.compute_centers(a, skel)
    bone_defs = {b.id: b for b in a.bones}
    joint_names = list(skel.bodies)
    bone_body = {(b.id, s): sk.body_of_bone(skel, b, s) for b in a.bones for s in b.sides()}

    by_ms = {(r.muscle, r.side): r for r in att_results}
    muscle_skin = {}
    for m in a.muscles:
        for side in an.SIDES:
            md = sc.muscles[(m.id, side)]
            res = by_ms[(m.id, side)]
            b0 = bone_defs[m.origin_bones[0]]
            fallback = sk.body_of_bone(skel, b0, side if b0.sided else None)
            j, w, order = sn.muscle_weights(md.positions.astype(np.float64), res.patches, skel, bone_defs, fallback)
            muscle_skin[(m.id, side)] = sn.to_skin_joint_arrays(j, w, order, joint_names)

    # skin: nearest-bone weights over the bodies that have bones
    verts: dict[str, list[np.ndarray]] = {}
    for (bid, s), md in sc.bones.items():
        verts.setdefault(bone_body[(bid, s)], []).append(md.positions.astype(np.float64))
    bone_vertices = {b: np.concatenate(v) for b, v in verts.items()}
    sj, sw, sbodies = sn.skin_weights(sc.skin.positions.astype(np.float64), bone_vertices)
    skin_skin = sn.to_skin_joint_arrays(sj, sw, sbodies, joint_names)
    return Rig(skel, joint_names, muscle_skin, skin_skin, bone_body)


# ---------------------------------------------------------------- posing
def skin_mesh(md: MeshData, joints: np.ndarray, weights: np.ndarray, mats: dict[str, np.ndarray], names: list[str]) -> np.ndarray:
    """Linear blend skinning of rest positions."""
    stack = np.stack([mats[n] for n in names])  # (J,4,4)
    p = np.hstack([md.positions.astype(np.float64), np.ones((len(md.positions), 1))])
    out = np.zeros((len(p), 3))
    for k in range(joints.shape[1]):
        m = stack[joints[:, k]]  # (n,4,4)
        out += weights[:, k : k + 1] * np.einsum("nij,nj->ni", m, p)[:, :3]
    return out


def posed_geometry(rig: Rig, sc, pose: dict[str, float]):
    """-> (muscles, bones, skin) posed vertex arrays keyed like the scene."""
    mats = sk.skin_matrices(rig.skel, pose)
    muscles = {k: skin_mesh(sc.muscles[k], *rig.muscle_skin[k], mats, rig.joint_names) for k in sc.muscles}
    bones = {k: sk.apply(mats, rig.bone_body[k], sc.bones[k].positions.astype(np.float64)) for k in sc.bones}
    skin = skin_mesh(sc.skin, *rig.skin_skin, mats, rig.joint_names)
    return muscles, bones, skin


def write_posed_glb(rig: Rig, sc, a: an.Anatomy, pose: dict[str, float], path, *, with_skin: bool = False) -> None:
    from pipeline.gltf_writer import GltfBuilder

    muscles, bones, skin = posed_geometry(rig, sc, pose)
    g = GltfBuilder()
    mm = g.material("m", (0.7, 0.25, 0.22, 1))
    mb = g.material("b", (0.93, 0.9, 0.82, 1))
    ms = g.material("s", (0.9, 0.72, 0.62, 0.3), blend=True)
    root = g.node("model")

    def md(src: MeshData, pos: np.ndarray) -> MeshData:
        t = trimesh.Trimesh(pos, src.indices, process=False)
        return MeshData(pos.astype(np.float32), np.asarray(t.vertex_normals, np.float32), src.indices)

    for m in a.muscles:
        for s in an.SIDES:
            g.mesh_node(m.node(s), md(sc.muscles[(m.id, s)], muscles[(m.id, s)]), mm, root)
    for b in a.bones:
        for s in b.sides():
            g.mesh_node(b.node(s), md(sc.bones[(b.id, s)], bones[(b.id, s)]), mb, root)
    if with_skin:
        g.mesh_node("skin", md(sc.skin, skin), ms, root)
    g.save(path)
