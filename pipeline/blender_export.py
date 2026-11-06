"""Blender (headless) script: export Z-Anatomy meshes to per-object PLY files.

Run via:  python -m pipeline.za_extract   (wraps the blender call)
or directly:
  blender -b Startup.blend --python pipeline/blender_export.py -- OUT_DIR

Exports evaluated meshes (modifiers applied) in world coordinates (metres,
Z-up, as stored in the .blend) for the skeletal, muscular and muscular-insertion
collections, plus an index.json with name / collection path / parent.
"""
import json
import os
import sys

import bpy

COLLECTIONS = tuple(sys.argv[sys.argv.index("--") + 2].split("|")) if len(sys.argv) > sys.argv.index("--") + 2 else ("1: Skeletal system", "2: Muscular insertions", "3: Joints", "4: Muscular system")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = argv[0]
os.makedirs(out_dir, exist_ok=True)

scene = bpy.context.scene
paths: dict[str, str] = {}


def walk(col, path):
    for ob in col.objects:
        paths.setdefault(ob.name, path)
    for ch in col.children:
        walk(ch, f"{path}/{ch.name}")


for top in scene.collection.children:
    if top.name in COLLECTIONS:
        walk(top, top.name)

depsgraph = bpy.context.evaluated_depsgraph_get()
index = []
for name, path in sorted(paths.items()):
    ob = bpy.data.objects.get(name)
    if ob is None or ob.type != "MESH":
        continue
    ev = ob.evaluated_get(depsgraph)
    me = ev.to_mesh()
    if me is None or len(me.polygons) == 0:
        ev.to_mesh_clear()
        continue
    me.calc_loop_triangles()
    mw = ob.matrix_world
    verts = [tuple(mw @ v.co) for v in me.vertices]
    tris = [tuple(t.vertices) for t in me.loop_triangles]
    ev.to_mesh_clear()
    fname = f"{len(index):05d}.ply"
    with open(os.path.join(out_dir, fname), "wb") as f:
        header = (
            "ply\nformat binary_little_endian 1.0\n"
            f"element vertex {len(verts)}\nproperty float x\nproperty float y\nproperty float z\n"
            f"element face {len(tris)}\nproperty list uchar int vertex_indices\nend_header\n"
        )
        f.write(header.encode("ascii"))
        import struct

        f.write(b"".join(struct.pack("<3f", *v) for v in verts))
        f.write(b"".join(struct.pack("<B3i", 3, *t) for t in tris))
    index.append(
        {
            "name": name,
            "file": fname,
            "collection": path,
            "parent": ob.parent.name if ob.parent else None,
            "verts": len(verts),
            "faces": len(tris),
        }
    )

with open(os.path.join(out_dir, "index.json"), "w") as f:
    json.dump(index, f, indent=1)
print(f"exported {len(index)} meshes to {out_dir}")
