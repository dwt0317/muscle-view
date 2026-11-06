"""Mesh helpers: Z-Anatomy -> glTF coordinates, decimation, normals, skin shell."""
from __future__ import annotations

import json
from dataclasses import dataclass

import fast_simplification
import numpy as np
import trimesh
from scipy import ndimage

from pipeline import za


@dataclass
class MeshData:
    positions: np.ndarray  # (n,3) float32, glTF space (Y-up, +Z anterior), metres
    normals: np.ndarray  # (n,3) float32
    indices: np.ndarray  # (m,3) uint32
    joints: np.ndarray | None = None  # (n,4) uint16
    weights: np.ndarray | None = None  # (n,4) float32

    @property
    def n_faces(self) -> int:
        return len(self.indices)


def clean(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    mesh = mesh.copy()
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    return mesh


def simplify(mesh: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
    """Quadric decimation to ~target_faces (no-op when already small enough)."""
    n = len(mesh.faces)
    if n <= target_faces or target_faces < 8:
        return mesh
    red = 1.0 - target_faces / n
    pts, faces = fast_simplification.simplify(
        np.asarray(mesh.vertices, dtype=np.float32), np.asarray(mesh.faces, dtype=np.int32),
        target_reduction=red, agg=5,
    )
    out = trimesh.Trimesh(pts, faces, process=False)
    out.update_faces(out.nondegenerate_faces())
    out.remove_unreferenced_vertices()
    return out


def to_gltf(mesh: trimesh.Trimesh) -> MeshData:
    """Convert a Z-Anatomy-space mesh into export data in glTF space with smooth normals."""
    v = za.za_to_gltf(mesh.vertices)
    m = trimesh.Trimesh(v, mesh.faces, process=False)
    return MeshData(
        positions=v.astype(np.float32),
        normals=np.asarray(m.vertex_normals, dtype=np.float32),
        indices=np.asarray(m.faces, dtype=np.uint32),
    )


def budget(faces: int, *, ratio: float, lo: int = 250, hi: int = 6000) -> int:
    return int(min(max(faces * ratio, lo), hi, faces))


# --------------------------------------------------------------------------- skin
SKIN_EXCLUDE = ("hair",)


def skin_source_meshes() -> list[trimesh.Trimesh]:
    ix = json.loads((za.SKIN_DIR / "index.json").read_text())
    out = []
    for e in ix:
        if any(k in e["name"].lower() for k in SKIN_EXCLUDE) or e["faces"] == 0:
            continue
        m = za.load_mesh(e["file"], root=za.SKIN_DIR)
        out.append(m)
    return out


def shell_from_surfaces(meshes: list[trimesh.Trimesh], pitch: float = 0.004, sigma: float = 1.0,
                        close_iters: int = 2) -> trimesh.Trimesh:
    """Watertight outer surface of a set of (possibly overlapping, thick, gappy) surface patches.

    Voxelise the union, close small gaps, fill the interior, smooth and run marching cubes.
    """
    from skimage import measure

    union = trimesh.util.concatenate(meshes)
    lo, hi = union.bounds[0] - 4 * pitch, union.bounds[1] + 4 * pitch
    shape = np.ceil((hi - lo) / pitch).astype(int) + 1
    occ = np.zeros(shape, dtype=bool)
    # rasterise triangles by dense surface sampling (>= 1 sample per voxel face)
    tri = union.triangles
    area = union.area_faces
    per_face = np.maximum(1, np.ceil(area / (pitch * pitch * 0.5)).astype(int))
    rng = np.random.default_rng(0)
    for chunk in np.array_split(np.arange(len(tri)), max(1, len(tri) // 20000)):
        reps = np.repeat(chunk, per_face[chunk])
        r1, r2 = rng.random((2, len(reps)))
        flip = r1 + r2 > 1
        r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
        t = tri[reps]
        p = t[:, 0] + r1[:, None] * (t[:, 1] - t[:, 0]) + r2[:, None] * (t[:, 2] - t[:, 0])
        idx = np.floor((p - lo) / pitch).astype(int)
        occ[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        for v in tri[chunk].reshape(-1, 3):  # make sure vertices themselves are marked
            i = np.floor((v - lo) / pitch).astype(int)
            occ[i[0], i[1], i[2]] = True
    # Seal gaps by dilation, flood the outside from the grid border, everything else is solid.
    sealed = ndimage.binary_dilation(occ, iterations=close_iters)
    labels, _ = ndimage.label(~sealed)
    outside = labels == labels[0, 0, 0]
    solid = ~outside
    solid = ndimage.binary_erosion(solid, iterations=close_iters)
    field = ndimage.gaussian_filter(solid.astype(np.float32), sigma)
    verts, faces, _, _ = measure.marching_cubes(field, level=0.5, spacing=(pitch,) * 3)
    verts += lo
    out = trimesh.Trimesh(verts, faces, process=True)
    if out.volume < 0:
        out.invert()
    # keep the large components only (drops stray specks)
    parts = out.split(only_watertight=False)
    parts = [p for p in parts if len(p.faces) > 500]
    return trimesh.util.concatenate(parts) if parts else out
