"""Headless Blender preview renderer for visual QA of pipeline outputs.

blender -b --python pipeline/blender_preview.py -- OUT.png VIEW FILE[:r,g,b,a] ...
VIEW: front | back | left | right ; FILE: .ply/.obj/.glb (Z-up metres for ply/obj)
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out, view, files = args[0], args[1], args[2:]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_xray = False
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
scene.render.film_transparent = False

objs = []
for spec in files:
    path, _, col = spec.partition(":")
    before = set(bpy.data.objects)
    if path.endswith(".ply"):
        bpy.ops.wm.ply_import(filepath=path)
    elif path.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=path, forward_axis="Y", up_axis="Z")
    elif path.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    rgba = [float(c) for c in col.split(",")] if col else [0.8, 0.8, 0.8, 1]
    if len(rgba) == 3:
        rgba.append(1)
    import os

    import re as _re

    hide = [h for h in os.environ.get("HIDE", "").split(",") if h]
    keep_rx = _re.compile(os.environ["KEEP"]) if os.environ.get("KEEP") else None
    for o in list(new):
        if any(o.name.startswith(h) for h in hide) or (keep_rx and not keep_rx.search(o.name)):
            bpy.data.objects.remove(o, do_unlink=True)
            new.remove(o)
    for o in new:
        if path.endswith((".glb", ".gltf")) and not col:
            o.color = ((0.75, 0.25, 0.22, 1) if o.name.startswith("m_")
                       else (1.0, 0.1, 0.1, 1) if o.name.startswith("p_") and "_o_" in o.name
                       else (0.1, 0.35, 1.0, 1) if o.name.startswith("p_")
                       else (0.93, 0.9, 0.82, 1) if o.name.startswith("b_") else (0.9, 0.72, 0.62, 1))
        else:
            o.color = rgba
    objs += new

if any(o.color[3] < 1 for o in objs):
    scene.display.shading.show_xray = True
    scene.display.shading.xray_alpha = 0.6

lo = Vector((min((o.matrix_world @ Vector(c))[i] for o in objs for c in o.bound_box) for i in range(3)))
hi = Vector((max((o.matrix_world @ Vector(c))[i] for o in objs for c in o.bound_box) for i in range(3)))
center = (lo + hi) / 2
size = max(hi - lo)
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * 1.1
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
# Z-up: front looks along +Y (BodyParts3D front faces -Y)
dirs = {"front": Vector((0, -1, 0)), "back": Vector((0, 1, 0)), "right": Vector((-1, 0, 0)), "left": Vector((1, 0, 0))}
d = dirs[view]
cam.location = center + d * size * 3
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_end = size * 10
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("wrote", out)
