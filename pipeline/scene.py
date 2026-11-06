"""Build the processed (decimated, glTF-space) mesh set from the Z-Anatomy export.

The result is cached in data_cache/build/scene.pkl; later pipeline stages (attachments, joints,
skinning, export) all work from the same processed meshes so that everything lines up exactly.
"""
from __future__ import annotations

import pickle
from dataclasses import dataclass, field

import trimesh
from trimesh import smoothing

from pipeline import anatomy as an
from pipeline import meshops as mo
from pipeline import za
from pipeline.paths import ANATOMY_DIR, BUILD_DIR

SCENE_PKL = BUILD_DIR / "scene.pkl"
SKIN_FACES = 70000

# decimation: fraction of source faces kept, with floor / cap per mesh
MUSCLE_BUDGET = dict(ratio=0.30, lo=300, hi=5000)
BONE_BUDGET = dict(ratio=0.50, lo=200, hi=12000)
CONTEXT_BONE_BUDGET = dict(ratio=0.12, lo=200, hi=6000)


@dataclass
class Scene:
    muscles: dict[tuple[str, str], mo.MeshData] = field(default_factory=dict)  # (id, side)
    bones: dict[tuple[str, str | None], mo.MeshData] = field(default_factory=dict)  # (id, side|None)
    skin: mo.MeshData | None = None
    source: dict[str, list[str]] = field(default_factory=dict)  # node name -> ZA mesh names


def _process(meshes: list[trimesh.Trimesh], target: int) -> mo.MeshData:
    total = sum(len(m.faces) for m in meshes)
    parts = []
    for m in meshes:
        m = mo.clean(m)
        t = max(60, int(target * len(m.faces) / max(total, 1))) if len(meshes) > 1 else target
        parts.append(mo.simplify(m, t))
    merged = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]
    return mo.to_gltf(merged)


def build(force: bool = False) -> Scene:
    newest_input = max(p.stat().st_mtime for p in ANATOMY_DIR.glob("*.yaml"))
    if SCENE_PKL.exists() and not force and SCENE_PKL.stat().st_mtime > newest_input:
        return pickle.loads(SCENE_PKL.read_bytes())

    a = an.load()
    ix = za.index()
    sc = Scene()

    for m in a.muscles:
        for s in an.SIDES:
            src = za.load_mesh(m.za_name(s))
            sc.muscles[(m.id, s)] = _process([src], mo.budget(len(src.faces), **MUSCLE_BUDGET))
            sc.source[m.node(s)] = [m.za_name(s)]

    for b in a.bones:
        for s in b.sides():
            names = b.resolve(ix, s)
            meshes = [za.load_mesh(n) for n in names]
            total = sum(len(x.faces) for x in meshes)
            budget = mo.budget(total, **(CONTEXT_BONE_BUDGET if b.context else BONE_BUDGET))
            sc.bones[(b.id, s)] = _process(meshes, budget)
            sc.source[b.node(s)] = names

    skin = mo.shell_from_surfaces(mo.skin_source_meshes(), pitch=0.004)
    smoothing.filter_taubin(skin, iterations=10)
    skin = mo.simplify(skin, SKIN_FACES)
    sc.skin = mo.to_gltf(skin)

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    SCENE_PKL.write_bytes(pickle.dumps(sc))
    return sc


def stats(sc: Scene) -> dict[str, int]:
    return {
        "muscle_nodes": len(sc.muscles),
        "bone_nodes": len(sc.bones),
        "muscle_faces": sum(m.n_faces for m in sc.muscles.values()),
        "bone_faces": sum(m.n_faces for m in sc.bones.values()),
        "skin_faces": sc.skin.n_faces if sc.skin else 0,
    }
