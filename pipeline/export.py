"""Export model.glb + manifest.json for the web viewer.

Usage: python -m pipeline.export [--rebuild] [--no-compress]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess

import numpy as np
import trimesh

from pipeline import anatomy as an
from pipeline import attachments as att_mod
from pipeline import landmarks as lm_mod
from pipeline import lengths as len_mod
from pipeline import motions as mo_mod
from pipeline import rig as rig_mod
from pipeline import skeleton as sk
from pipeline import scene as sc_mod
from pipeline import za
from pipeline.gltf_writer import GltfBuilder
from pipeline.meshops import MeshData
from pipeline.paths import BUILD_DIR, ROOT, WEB_DATA_DIR

ATTRIBUTION = [
    "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan",
    "Z-Anatomy (https://www.z-anatomy.com), CC BY-SA 4.0",
]
CLINICAL_NOTE = {
    "zh": "起止点、功能与动作表为参照教材整理，待临床确认。",
    "en": "Attachments, functions and motion tables are compiled from textbooks and pending clinical review.",
}


def fma_ids(base: str) -> dict[str, str | None]:
    return {s: za.fma_for(base.replace(" muscle", ""), s) for s in an.SIDES}


def build_manifest(a: an.Anatomy, extra: dict | None = None) -> dict:
    muscles = []
    for m in a.muscles:
        muscles.append({
            "id": m.id,
            "nodes": {s: m.node(s) for s in an.SIDES},
            "regions": m.regions, "group": m.group, "layer": m.layer, "kind": m.kind,
            "name": m.name, "origin": m.origin, "insertion": m.insertion, "function": m.function,
            "originBones": m.origin_bones, "insertionBones": m.insertion_bones,
            "tendinous": m.tendinous,
            "fma": fma_ids(m.za),
        })
    bones = []
    for b in a.bones:
        nodes = {s: b.node(s) for s in an.SIDES} if b.sided else {"": b.node(None)}
        bones.append({"id": b.id, "nodes": nodes, "sided": b.sided, "regions": b.regions,
                      "name": b.name, "context": b.context, "body": b.body})
    out = {
        "version": 1,
        "attribution": ATTRIBUTION,
        "clinicalNote": CLINICAL_NOTE,
        "regions": a.regions,
        "groups": a.groups,
        "muscles": muscles,
        "bones": bones,
        "skinNode": "skin",
    }
    out.update(extra or {})
    return out


def skeleton_manifest(skel: sk.Skeleton) -> dict:
    """Everything the web viewer needs to pose the body (same maths as pipeline.skeleton)."""
    return {
        "joints": list(skel.bodies),
        "bodies": [
            {
                "id": b.id,
                "parent": b.parent,
                "center": [round(float(x), 5) for x in b.center],
                "trunk": b.trunk,
                "frameFrom": b.frame_from,
                "dofs": [{"name": d.name, "axis": [float(x) for x in d.axis], "sign": d.sign, "share": d.share} for d in b.dofs],
            }
            for b in skel.bodies.values()
        ],
        "trunkDofs": [
            {"name": d["name"], "axis": [float(x) for x in d["axis"]], "sign": d["sign"], "shares": d["shares"]}
            for d in skel.trunk_dofs
        ],
    }


def write_rigged_glb(sc: sc_mod.Scene, a: an.Anatomy, rig: rig_mod.Rig, path, patches: dict | None = None,
                     patch_body: dict | None = None) -> None:
    """Skeleton of joint nodes; bones / decals ride on them rigidly, muscles and skin are skinned to all joints."""
    skel = rig.skel
    g = GltfBuilder()
    mat_m = g.material("muscle", (0.72, 0.27, 0.24, 1.0), roughness=0.65)
    mat_b = g.material("bone", (0.93, 0.90, 0.82, 1.0), roughness=0.8)
    mat_s = g.material("skin", (0.90, 0.72, 0.62, 0.35), roughness=0.9, blend=True, double_sided=True)
    mat_o = g.material("patch_origin", (1.0, 0.25, 0.25, 1.0), roughness=0.5)
    mat_i = g.material("patch_insertion", (0.25, 0.55, 1.0, 1.0), roughness=0.5)

    root = g.node("model")
    jnode: dict[str, int] = {}
    for bid, b in skel.bodies.items():
        if b.parent is None:
            jnode[bid] = g.node(f"j_{bid}", root, translation=b.center, extras={"kind": "joint", "body": bid})
        else:
            jnode[bid] = g.node(f"j_{bid}", jnode[b.parent], translation=b.center - skel.bodies[b.parent].center,
                                extras={"kind": "joint", "body": bid})
    ibm = np.stack([sk.translation(-skel.bodies[n].center) for n in rig.joint_names])
    skin = g.skin([jnode[n] for n in rig.joint_names], ibm)

    def rigid(name: str, md: MeshData, body: str, material: int, extras: dict) -> None:
        g.mesh_node(name, md, material, jnode[body], translation=-skel.bodies[body].center, extras=extras)

    def skinned(md: MeshData, jw) -> MeshData:
        return MeshData(md.positions, md.normals, md.indices, joints=jw[0], weights=jw[1])

    for m in a.muscles:
        for s in an.SIDES:
            g.mesh_node(m.node(s), skinned(sc.muscles[(m.id, s)], rig.muscle_skin[(m.id, s)]), mat_m, root,
                        extras={"kind": "muscle", "id": m.id, "side": s}, skin=skin)
    for b in a.bones:
        for s in b.sides():
            rigid(b.node(s), sc.bones[(b.id, s)], rig.bone_body[(b.id, s)], mat_b, {"kind": "bone", "id": b.id, "side": s})
    g.mesh_node("skin", skinned(sc.skin, rig.skin_skin), mat_s, root, extras={"kind": "skin"}, skin=skin)
    for name, (md, extras) in (patches or {}).items():
        rigid(name, md, patch_body[name], mat_o if extras["role"] == "origin" else mat_i, extras)
    g.save(path)


def compress(src, dst) -> None:
    npx = shutil.which("npx")
    if not npx:
        raise SystemExit("npx not found (Node.js is required for meshopt compression)")
    subprocess.run([npx, "--yes", "@gltf-transform/cli@4", "meshopt", str(src), str(dst), "--level", "high"],
                   check=True, stdout=subprocess.DEVNULL)


def verify(raw, compressed, tol_mm: float = 0.5) -> None:
    """Reload both files with three's GLTFLoader (needs `npm install` in web/) and compare world-space geometry,
    including skinning. Fails the export when compression changed the shape."""
    node = shutil.which("node")
    script = ROOT / "tools" / "verify_glb.mjs"
    if not node or not (ROOT / "web" / "node_modules" / "three").exists():
        print("verify: skipped (node or web/node_modules missing)")
        return
    r = subprocess.run([node, str(script), str(raw), str(compressed), str(tol_mm)], capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        raise SystemExit(f"compressed model differs from the raw model:\n{r.stdout}{r.stderr}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="ignore the mesh cache")
    ap.add_argument("--no-compress", action="store_true")
    args = ap.parse_args()

    a = an.load()
    sc = sc_mod.build(force=args.rebuild)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw = BUILD_DIR / "model_raw.glb"
    overrides = an.read_yaml("attachment_overrides.yaml")
    att_results, _ = att_mod.run(sc, a, overrides)
    rig = rig_mod.build_rig(sc, a, att_results)
    bone_defs = {b.id: b for b in a.bones}
    patches = att_mod.group_meshes(sc, att_results)
    patch_body = {
        att_mod.patch_node_name(p.muscle, p.side, p.role, p.bone): sk.body_of_bone(rig.skel, bone_defs[p.bone], p.bone_side)
        for r in att_results for p in r.patches
    }
    write_rigged_glb(sc, a, rig, raw, patches, patch_body)
    final = WEB_DATA_DIR / "model.glb"
    if args.no_compress:
        shutil.copy(raw, final)
    else:
        compress(raw, final)
        verify(raw, final)
    skin = trimesh.Trimesh(sc.skin.positions, sc.skin.indices, process=False)
    landmarks = lm_mod.compute(a, an.read_yaml("landmarks.yaml")["landmarks"], skin, za.index())
    for d, lmk in zip(an.read_yaml("landmarks.yaml")["landmarks"], landmarks):
        bone = a.bone(d["bone"])
        for side, item in lmk["items"].items():
            item["body"] = sk.body_of_bone(rig.skel, bone, side or None)
    motions = mo_mod.load()
    problems = mo_mod.validate(motions, a, rig.skel)
    if problems:
        raise SystemExit("motions.yaml is invalid:\n" + "\n".join(map(str, problems)))
    manifest = build_manifest(a, {"stats": sc_mod.stats(sc), "landmarks": landmarks, "skeleton": skeleton_manifest(rig.skel),
                                              "motions": motions, "lengthPaths": len_mod.to_manifest(len_mod.build_paths(a, att_results, rig.skel)),
                                              "attachments": att_mod.summarize(att_results)})
    (WEB_DATA_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("stats:", sc_mod.stats(sc))
    print(f"model.glb: raw {raw.stat().st_size / 1e6:.1f} MB -> {final.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
