"""Surface landmark computation: bony extreme points on the full-resolution bones, projected onto the skin.

Usage: python -m pipeline.landmarks      (prints a table; export.py embeds the result in manifest.json)
"""
from __future__ import annotations

import re

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from pipeline import anatomy as an
from pipeline import za

# glTF space: +Y superior, +Z anterior, patient right = -X
_FIXED = {
    "anterior": (0.0, 0.0, 1.0),
    "posterior": (0.0, 0.0, -1.0),
    "superior": (0.0, 1.0, 0.0),
    "inferior": (0.0, -1.0, 0.0),
}
MIDLINE_HALF_WIDTH = 0.008  # m
NEAR_MUSCLE_RADIUS = 0.015  # m


def axis_vector(name: str, side: str | None) -> np.ndarray:
    if name in _FIXED:
        return np.array(_FIXED[name])
    if name in ("lateral", "medial"):
        if side is None:
            raise ValueError(f"{name!r} needs a side")
        lateral_x = -1.0 if side == "r" else 1.0
        return np.array([lateral_x if name == "lateral" else -lateral_x, 0.0, 0.0])
    raise ValueError(f"unknown anatomical direction {name!r}")


def dir_vector(weights: dict[str, float], side: str | None) -> np.ndarray:
    v = sum(w * axis_vector(k, side) for k, w in weights.items())
    n = np.linalg.norm(v)
    if n == 0:
        raise ValueError("direction weights cancel out")
    return v / n


def pick_extreme(verts: np.ndarray, direction: np.ndarray, *, within: dict | None = None,
                 midline: bool = False, side: str | None = None) -> int:
    """Index of the vertex that is farthest along `direction`, optionally restricted to a slab / the midline."""
    mask = np.ones(len(verts), dtype=bool)
    if within:
        a = axis_vector(within["axis"], side)
        p = verts @ a
        lo, hi = p.min(), p.max()
        f0, f1 = within["frac"]
        mask &= (p >= lo + f0 * (hi - lo)) & (p <= lo + f1 * (hi - lo))
    if midline:
        mask &= np.abs(verts[:, 0]) < MIDLINE_HALF_WIDTH
    if not mask.any():
        raise ValueError("no vertices left after applying the landmark filters")
    score = np.where(mask, verts @ direction, -np.inf)
    return int(np.argmax(score))


def project_to_skin(skin: trimesh.Trimesh, origin: np.ndarray, direction: np.ndarray) -> tuple[np.ndarray, bool]:
    """First skin hit when shooting from `origin` along `direction`; falls back to the closest skin point."""
    locs, _, _ = skin.ray.intersects_location(origin[None], direction[None])
    if len(locs):
        d = (locs - origin) @ direction
        ahead = d > 1e-6
        if ahead.any():
            return locs[ahead][np.argmin(d[ahead])], True
    closest, _, _ = trimesh.proximity.closest_point(skin, origin[None])
    return closest[0], False


def _bone_vertices(bone: an.Bone, side: str | None, mesh_re: str | None, ix: dict) -> np.ndarray:
    names = bone.resolve(ix, side)
    if mesh_re:
        rx = re.compile(mesh_re)
        names = [n for n in names if rx.match(re.sub(r"\.[rl]$", "", n))]
    if not names:
        raise ValueError(f"no meshes for bone {bone.id} (mesh={mesh_re}, side={side})")
    v = np.concatenate([za.load_mesh(n).vertices for n in names])
    return za.za_to_gltf(v)


def _muscle_trees(a: an.Anatomy) -> dict[tuple[str, str], cKDTree]:
    return {(m.id, s): cKDTree(za.za_to_gltf(za.load_mesh(m.za_name(s)).vertices)) for m in a.muscles for s in an.SIDES}


def compute(a: an.Anatomy, defs: list[dict], skin: trimesh.Trimesh, ix: dict) -> list[dict]:
    trees = _muscle_trees(a)
    out = []
    for d in defs:
        bone = a.bone(d["bone"])
        midline = bool(d.get("midline"))
        sides: tuple[str | None, ...] = (None,) if (midline or not bone.sided) else an.SIDES
        items = {}
        for s in sides:
            verts = _bone_vertices(bone, s, d.get("mesh"), ix)
            direction = dir_vector(d["dir"], s)
            i = pick_extreme(verts, direction, within=d.get("within"), midline=midline, side=s)
            bone_pos = verts[i]
            skin_pos, hit = project_to_skin(skin, bone_pos, dir_vector(d.get("project", d["dir"]), s))
            near = []
            for (mid, side), t in trees.items():
                if s is not None and side != s:
                    continue
                dist = float(t.query(bone_pos)[0])
                if dist < NEAR_MUSCLE_RADIUS:
                    near.append((dist, mid))
            seen: list[str] = []
            for _, mid in sorted(near):
                if mid not in seen:
                    seen.append(mid)
            related = [r for r in d.get("related", [])]
            merged = related + [m for m in seen if m not in related]
            items[s or ""] = {
                "bonePos": [round(float(x), 4) for x in bone_pos],
                "skinPos": [round(float(x), 4) for x in skin_pos],
                "depthMm": round(float(np.linalg.norm(skin_pos - bone_pos)) * 1000, 1),
                "rayHit": hit,
                "muscles": merged[:8],
            }
        out.append({
            "id": d["id"], "bone": d["bone"], "body": bone.body, "sided": bool(sides[0]),
            "regions": d["regions"], "name": d["name"], "palpation": d["palpation"], "items": items,
        })
    return out


def main() -> None:
    from pipeline import scene as sc_mod

    a = an.load()
    sc = sc_mod.build()
    skin = trimesh.Trimesh(sc.skin.positions, sc.skin.indices, process=False)
    res = compute(a, an.read_yaml("landmarks.yaml")["landmarks"], skin, za.index())
    for r in res:
        for s, it in r["items"].items():
            print(f"{r['id']:<28}{s or '-':<2} depth {it['depthMm']:6.1f} mm  hit={it['rayHit']!s:<5} "
                  f"pos={it['bonePos']} muscles={it['muscles']}")


if __name__ == "__main__":
    main()
