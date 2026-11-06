"""Muscle origin / insertion extraction.

For every muscle (per side) and every bone it is documented to attach to (anatomy/muscles.yaml), find the bone
triangles that lie within a distance tau of the muscle surface, cluster them (connected components) and label each cluster as
origin or insertion:

* a bone that appears only in `origin_bones` (or only in `insertion_bones`) decides the role of its clusters;
* a bone that appears in both lists (e.g. transversus abdominis on the hip bone, spinal muscles on vertebrae) is
  resolved per cluster by which end of the muscle the cluster is closer to;
* if a role ends up with too little area, tau is increased step by step (muscles that attach through long tendons or
  aponeuroses are not in direct contact in the mesh).

Per-muscle exceptions live in anatomy/attachment_overrides.yaml. Z-Anatomy's hand-made attachment decals are used as a
QA reference and can be adopted per muscle with `source: za`.

Usage: python -m pipeline.attachments        (prints the QA report)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from pipeline import anatomy as an
from pipeline import za

DEFAULT_TAU_MM = 2.5  # chosen by a parameter sweep against Z-Anatomy's hand-drawn decals (mean F1 0.54)
DEFAULT_END_FRAC = 1.0  # fraction of the muscle length (from each end) searched; sweeping 0.2-0.4 scored worse
TENDINOUS_TAU_MM = 4.5
TAU_STEPS_MM = (5.0, 8.0, 12.0, 18.0, 25.0)
MIN_ROLE_AREA_CM2 = 0.5
MIN_CLUSTER_AREA_CM2 = 0.25
CLOSE_RINGS = 2  # morphological closing on the bone surface graph: bridges gaps left by noisy / decimated muscle surfaces
SAMPLE_SPACING_M = 0.002
PATCH_LIFT_M = 0.0004  # attachment decals float slightly above the bone surface (no z-fighting)
SPINAL_GROUPS = {"transversospinalis", "erector_spinae", "lumbar_other"}


@dataclass
class Patch:
    muscle: str
    side: str
    role: str  # 'origin' | 'insertion'
    bone: str
    bone_side: str | None
    faces: np.ndarray  # indices into the processed bone mesh
    area: float  # m^2
    center: np.ndarray  # area-weighted centroid, glTF space
    tau_mm: float
    source: str = "algorithm"

    @property
    def area_cm2(self) -> float:
        return self.area * 1e4


@dataclass
class MuscleResult:
    muscle: str
    side: str
    patches: list[Patch] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- geometry helpers
def sample_surface(mesh: trimesh.Trimesh, spacing: float = SAMPLE_SPACING_M, cap: int = 200_000) -> np.ndarray:
    n = int(min(cap, max(2000, mesh.area / spacing**2)))
    pts, _ = trimesh.sample.sample_surface(mesh, n, seed=0)
    return np.vstack([pts, mesh.vertices])


def face_centroids(m: trimesh.Trimesh) -> np.ndarray:
    return m.triangles_center


def contact_faces(bone: trimesh.Trimesh, muscle_tree: cKDTree, tau_m: float) -> np.ndarray:
    """Indices of bone faces whose centroid is within tau of the muscle surface samples."""
    d, _ = muscle_tree.query(face_centroids(bone), distance_upper_bound=tau_m)
    return np.where(np.isfinite(d))[0]


_ADJ_CACHE: dict[int, tuple[trimesh.Trimesh, sp.csr_matrix]] = {}


def face_graph(bone: trimesh.Trimesh) -> sp.csr_matrix:
    """Symmetric face adjacency (faces sharing an edge) as a sparse 0/1 matrix, cached per mesh object."""
    hit = _ADJ_CACHE.get(id(bone))
    if hit is not None and hit[0] is bone:
        return hit[1]
    adj = bone.face_adjacency
    n = len(bone.faces)
    g = sp.coo_matrix((np.ones(len(adj) * 2), (np.r_[adj[:, 0], adj[:, 1]], np.r_[adj[:, 1], adj[:, 0]])), shape=(n, n)).tocsr()
    _ADJ_CACHE[id(bone)] = (bone, g)
    return g


def close_mask(g: sp.csr_matrix, mask: np.ndarray, rings: int) -> np.ndarray:
    """Dilate `rings` times then erode `rings` times on the face graph (fills holes / bridges narrow gaps)."""
    if rings <= 0 or not mask.any():
        return mask
    deg = np.asarray(g.sum(1)).ravel()
    m = mask.copy()
    for _ in range(rings):
        m = (g @ m.astype(float) + m) > 0
    for _ in range(rings):
        m = m & ((g @ m.astype(float)) >= deg - 1e-9)
    return m | mask


def cluster_faces(bone: trimesh.Trimesh, faces: np.ndarray, rings: int, min_area_m2: float) -> list[np.ndarray]:
    """Close the contact set on the bone surface and split it into connected patches above `min_area_m2`."""
    if len(faces) == 0:
        return []
    g = face_graph(bone)
    mask = np.zeros(len(bone.faces), dtype=bool)
    mask[faces] = True
    mask = close_mask(g, mask, rings)
    idx = np.where(mask)[0]
    _, labels = connected_components(g[idx][:, idx], directed=False)
    out = []
    for lab in np.unique(labels):
        f = idx[labels == lab]
        if bone.area_faces[f].sum() >= min_area_m2:
            out.append(f)
    return out


def area_center(bone: trimesh.Trimesh, faces: np.ndarray) -> tuple[float, np.ndarray]:
    a = bone.area_faces[faces]
    c = face_centroids(bone)[faces]
    return float(a.sum()), (c * a[:, None]).sum(0) / a.sum()


def muscle_ends(mesh: trimesh.Trimesh, frac: float = 0.12) -> tuple[np.ndarray, np.ndarray]:
    """Two end points of the muscle along its principal axis (mean of the extreme `frac` of vertices)."""
    v = mesh.vertices
    c = v.mean(0)
    _, _, vt = np.linalg.svd(v - c, full_matrices=False)
    axis = vt[0]
    s = (v - c) @ axis
    k = max(5, int(len(v) * frac))
    order = np.argsort(s)
    return v[order[:k]].mean(0), v[order[-k:]].mean(0)


# ---------------------------------------------------------------- extraction
def _role_bones(m: an.Muscle) -> tuple[list[str], list[str], list[str]]:
    o, i = list(dict.fromkeys(m.origin_bones)), list(dict.fromkeys(m.insertion_bones))
    both = [b for b in o if b in i]
    return [b for b in o if b not in both], [b for b in i if b not in both], both


def extract_muscle(
    m: an.Muscle,
    side: str,
    muscle_mesh: trimesh.Trimesh,
    bones: dict[tuple[str, str | None], trimesh.Trimesh],
    bone_defs: dict[str, an.Bone],
    *,
    tau_mm: float | None = None,
    min_cluster_cm2: float = MIN_CLUSTER_AREA_CM2,
    min_role_cm2: float = MIN_ROLE_AREA_CM2,
    end_frac: float | None = None,
) -> MuscleResult:
    res = MuscleResult(m.id, side)
    samples = sample_surface(muscle_mesh)
    if end_frac is None:
        end_frac = DEFAULT_END_FRAC
    only_o, only_i, both = _role_bones(m)
    end_a, end_b = muscle_ends(muscle_mesh)

    def bone_mesh(bid: str) -> tuple[trimesh.Trimesh, str | None]:
        bs = side if bone_defs[bid].sided else None
        return bones[(bid, bs)], bs

    # Which end is the origin? the end closer to the origin-only bones, else the caudal end (spinal muscles).
    def centroid_of(ids: list[str]) -> np.ndarray | None:
        return np.mean([bone_mesh(b)[0].vertices.mean(0) for b in ids], axis=0) if ids else None

    co, ci = centroid_of(only_o), centroid_of(only_i)
    if co is not None and ci is not None:
        origin_end = end_a if np.linalg.norm(end_a - co) + np.linalg.norm(end_b - ci) <= \
            np.linalg.norm(end_b - co) + np.linalg.norm(end_a - ci) else end_b
    elif co is not None:
        origin_end = end_a if np.linalg.norm(end_a - co) <= np.linalg.norm(end_b - co) else end_b
    elif ci is not None:
        origin_end = end_b if np.linalg.norm(end_a - ci) <= np.linalg.norm(end_b - ci) else end_a
    else:
        origin_end = end_a if end_a[1] <= end_b[1] else end_b  # caudal end
    insertion_end = end_b if origin_end is end_a else end_a

    tau0 = tau_mm if tau_mm is not None else (TENDINOUS_TAU_MM if m.tendinous else DEFAULT_TAU_MM)
    steps = [tau0] + [t for t in TAU_STEPS_MM if t > tau0]

    # Surface samples near each end of the muscle (position along the principal axis, 0 = origin end, 1 = insertion end)
    axis = insertion_end - origin_end
    length2 = float(axis @ axis) or 1.0
    t = (samples - origin_end) @ axis / length2
    role_tree = {
        "origin": cKDTree(samples[t <= end_frac] if (t <= end_frac).any() else samples),
        "insertion": cKDTree(samples[t >= 1 - end_frac] if (t >= 1 - end_frac).any() else samples),
    }
    if end_frac >= 1.0:
        role_tree = {"origin": cKDTree(samples), "insertion": cKDTree(samples)}

    def collect(role: str, tau: float) -> list[Patch]:
        out: list[Patch] = []
        tree = role_tree[role]
        ids = (only_o if role == "origin" else only_i) + both
        for bid in ids:
            bm, bs = bone_mesh(bid)
            faces = contact_faces(bm, tree, tau / 1000)
            for cl in cluster_faces(bm, faces, CLOSE_RINGS, min_cluster_cm2 * 1e-4):
                area, center = area_center(bm, cl)
                if bid in both:  # decide per cluster by which muscle end is closer
                    d_o, d_i = np.linalg.norm(center - origin_end), np.linalg.norm(center - insertion_end)
                    if (d_o <= d_i) != (role == "origin"):
                        continue
                out.append(Patch(m.id, side, role, bid, bs, cl, area, center, tau))
        return out

    for role in ("origin", "insertion"):
        for tau in steps:
            patches = collect(role, tau)
            if sum(p.area_cm2 for p in patches) >= min_role_cm2:
                break
        if tau != tau0 and patches:
            res.notes.append(f"{role}: tau widened to {tau:g} mm")
        if not patches:
            res.notes.append(f"{role}: no contact found up to {steps[-1]:g} mm")
        res.patches += patches
    return res


def load_decal(name: str) -> trimesh.Trimesh:
    """A Z-Anatomy attachment decal converted to glTF space."""
    m = za.load_mesh(name)
    return trimesh.Trimesh(za.za_to_gltf(m.vertices), m.faces, process=False)


# ---------------------------------------------------------------- overrides
def apply_override(res: MuscleResult, ov: dict, bones, bone_defs) -> MuscleResult:
    """Post-process one muscle: `drop` clusters (role/bone/near/radius_mm)."""
    for d in ov.get("drop", []):
        keep = []
        for p in res.patches:
            hit = (d.get("role") in (None, p.role) and d.get("bone") in (None, p.bone))
            if hit and "near" in d:
                hit = np.linalg.norm(p.center - np.array(d["near"])) * 1000 <= d.get("radius_mm", 15)
            if hit:
                res.notes.append(f"override: dropped {p.role} patch on {p.bone} ({p.area_cm2:.1f} cm2)")
            else:
                keep.append(p)
        res.patches = keep
    return res


def patches_from_reference(m: an.Muscle, side: str, bones, bone_defs, ix: dict) -> list[Patch]:
    """Adopt Z-Anatomy's hand-drawn decals: bone faces within 1.2 mm of the decal surface.

    Z-Anatomy's .o / .e prefixes do not follow the textbook origin / insertion convention (e.g. its pectoralis minor
    .or decal sits on the coracoid process), so the role is decided by our own bone lists; only bones listed for both
    roles fall back to the decal prefix.
    """
    out: list[Patch] = []
    only_o, only_i, both = _role_bones(m)
    ref = za.reference_patches(m.za, side)
    for prefix_role, entries in ref.items():
        for e in entries:
            decal = load_decal(e["name"])
            tree = cKDTree(sample_surface(decal, 0.0015))
            for bd in bone_defs.values():
                bs = side if bd.sided else None
                if (bd.id, bs) not in bones or e["parent"] not in bd.resolve(ix, bs):
                    continue
                role = "origin" if bd.id in only_o else "insertion" if bd.id in only_i else prefix_role
                bm = bones[(bd.id, bs)]
                faces = contact_faces(bm, tree, 0.0012)
                for cl in cluster_faces(bm, faces, CLOSE_RINGS, MIN_CLUSTER_AREA_CM2 * 1e-4):
                    area, center = area_center(bm, cl)
                    out.append(Patch(m.id, side, role, bd.id, bs, cl, area, center, 1.2, source="za"))
    return out


def point_patch(m: an.Muscle, side: str, spec: dict, bones, bone_defs, ix: dict) -> Patch | None:
    """A small patch around the bone's extreme point in a given anatomical direction (for tendons missing from the mesh)."""
    from pipeline import landmarks as lm

    bd = bone_defs[spec["bone"]]
    bs = side if bd.sided else None
    names = bd.resolve(ix, bs)
    if spec.get("mesh"):
        import re

        names = [n for n in names if re.match(spec["mesh"], re.sub(r"\.[rl]$", "", n))]
    if not names:
        return None
    bm = bones[(bd.id, bs)]
    # the processed bone mesh is a merge of all its parts; restrict to the part's vertices by proximity to the full-res part
    verts = np.concatenate([lm._bone_vertices(bd, bs, spec.get("mesh"), ix)])
    direction = lm.dir_vector(spec["dir"], side)
    target = verts[lm.pick_extreme(verts, direction, within=spec.get("within"), side=side)]
    d = np.linalg.norm(face_centroids(bm) - target, axis=1)
    faces = np.where(d <= spec.get("radius_mm", 8) / 1000)[0]
    if len(faces) == 0:
        return None
    area, center = area_center(bm, faces)
    return Patch(m.id, side, spec["role"], bd.id, bs, faces, area, center, 0.0, source="point")


# ---------------------------------------------------------------- QA vs reference
def reference_score(m: an.Muscle, side: str, patches: list[Patch], bones, bone_defs, ix: dict) -> dict | None:
    """Agreement with Z-Anatomy's hand-drawn decals (origin ∪ insertion), measured on the bone surface.

    recall    = share of decal area whose nearest bone face (within 3 mm) is one of ours
    precision = share of our patch area that lies within 2.5 mm of a decal
    """
    ref = za.reference_patches(m.za, side)
    entries = ref["origin"] + ref["insertion"]
    if not entries:
        return None
    ours: dict[tuple[str, str | None], np.ndarray] = {}
    for p in patches:
        ours.setdefault((p.bone, p.bone_side), np.zeros(len(bones[(p.bone, p.bone_side)].faces), dtype=bool))[p.faces] = True
    ref_area = hit_ref = our_area = hit_our = 0.0
    for e in entries:
        decal = load_decal(e["name"])
        pts = sample_surface(decal, 0.002)
        w = decal.area / len(pts)
        bd = next((b for b in bone_defs.values()
                   if e["parent"] in b.resolve(ix, side if b.sided else None) and (b.id, side if b.sided else None) in bones), None)
        if bd is None:
            continue
        key = (bd.id, side if bd.sided else None)
        bm = bones[key]
        d, nearest = cKDTree(face_centroids(bm)).query(pts, distance_upper_bound=0.003)
        ok = np.isfinite(d)
        ref_area += w * len(pts)
        mine = ours.get(key)
        if mine is not None:
            hit_ref += w * np.count_nonzero(mine[nearest[ok]])
    dec_tree = cKDTree(np.vstack([sample_surface(load_decal(e["name"]), 0.002) for e in entries]))
    for key, mask in ours.items():
        bm = bones[key]
        f = np.where(mask)[0]
        d, _ = dec_tree.query(face_centroids(bm)[f])
        our_area += bm.area_faces[f].sum()
        hit_our += bm.area_faces[f][d < 0.0025].sum()
    recall = hit_ref / ref_area if ref_area else 0.0
    precision = hit_our / our_area if our_area else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": float(precision), "recall": float(recall), "f1": float(f1),
            "ref_cm2": ref_area * 1e4, "our_cm2": our_area * 1e4}


# ---------------------------------------------------------------- orchestration
def run(sc, a: an.Anatomy, overrides: dict | None = None, *, with_score: bool = False):
    ix = za.index()
    bone_defs = {b.id: b for b in a.bones}
    bones = {k: trimesh.Trimesh(v.positions, v.indices, process=False) for k, v in sc.bones.items()}
    ov_by_id: dict[tuple[str, str], dict] = {}
    for ov in (overrides or {}).get("overrides", []):
        for s in (an.SIDES if ov.get("side", "both") == "both" else (ov["side"],)):
            ov_by_id[(ov["muscle"], s)] = ov
    results: dict[tuple[str, str], MuscleResult] = {}
    scores: dict[tuple[str, str], dict | None] = {}
    muscles = {m.id: m for m in a.muscles}

    def base(m: an.Muscle, s: str) -> MuscleResult:
        mm = trimesh.Trimesh(sc.muscles[(m.id, s)].positions, sc.muscles[(m.id, s)].indices, process=False)
        ov = ov_by_id.get((m.id, s), {})
        algo = extract_muscle(m, s, mm, bones, bone_defs, tau_mm=ov.get("tau_mm"), end_frac=ov.get("end_frac"),
                              min_cluster_cm2=ov.get("min_cluster_cm2", MIN_CLUSTER_AREA_CM2))
        if ov.get("source") != "za":
            return algo
        res = MuscleResult(m.id, s, patches_from_reference(m, s, bones, bone_defs, ix), ["source: Z-Anatomy decals"])
        for role in ("origin", "insertion"):
            if not any(p.role == role for p in res.patches):
                fill = [p for p in algo.patches if p.role == role]
                res.patches += fill
                res.notes.append(f"{role}: no Z-Anatomy decal, algorithm used" if fill else f"{role}: none found")
        return res

    for m in a.muscles:
        for s in an.SIDES:
            results[(m.id, s)] = base(m, s)
    # second pass: operations that depend on other muscles / extra geometry
    for (mid, s), res in results.items():
        ov = ov_by_id.get((mid, s), {})
        res = apply_override(res, ov, bones, bone_defs)
        for spec in ov.get("add_point_patch", []):
            p = point_patch(muscles[mid], s, spec, bones, bone_defs, ix)
            if p:
                res.patches = [q for q in res.patches if not (spec.get("replace") and q.role == p.role)] + [p]
                res.notes.append(f"override: {p.role} point patch on {p.bone}")
        results[(mid, s)] = res
    for (mid, s), res in list(results.items()):
        cp = ov_by_id.get((mid, s), {}).get("copy_from")
        if cp:
            src = results[(cp["muscle"], s)]
            role = cp["role"]
            res.patches = [q for q in res.patches if q.role != role] + [
                Patch(mid, s, role, q.bone, q.bone_side, q.faces, q.area, q.center, q.tau_mm, source=f"copy:{cp['muscle']}")
                for q in src.patches if q.role == role
            ]
            res.notes.append(f"override: {role} copied from {cp['muscle']}")
    if with_score:
        for m in a.muscles:
            for s in an.SIDES:
                scores[(m.id, s)] = reference_score(m, s, results[(m.id, s)].patches, bones, bone_defs, ix)
    return list(results.values()), scores


def patch_mesh(sc, patch: Patch, lift_m: float = 0.0002):
    """The patch as its own mesh (copy of the bone faces, lifted slightly along the normals)."""
    from pipeline.meshops import MeshData

    bm = sc.bones[(patch.bone, patch.bone_side)]
    tri = bm.indices[patch.faces]
    used, inv = np.unique(tri.reshape(-1), return_inverse=True)
    pos = bm.positions[used] + bm.normals[used] * lift_m
    return MeshData(positions=pos.astype(np.float32), normals=bm.normals[used].astype(np.float32),
                    indices=inv.reshape(-1, 3).astype(np.uint32))


def patch_node_name(muscle: str, side: str, role: str, bone: str) -> str:
    return f"p_{muscle}_{side}_{'o' if role == 'origin' else 'i'}_{bone}"


def group_meshes(sc, results: list[MuscleResult]) -> dict[str, tuple]:
    """One mesh per (muscle, side, role, bone), merging that group's clusters. -> {node name: (MeshData, extras)}"""
    from pipeline.meshops import MeshData

    groups: dict[tuple, list[Patch]] = {}
    for r in results:
        for p in r.patches:
            groups.setdefault((p.muscle, p.side, p.role, p.bone, p.bone_side), []).append(p)
    out = {}
    for (mid, side, role, bone, bone_side), ps in groups.items():
        bm = sc.bones[(bone, bone_side)]
        faces = np.unique(np.concatenate([p.faces for p in ps]))
        tri = bm.indices[faces]
        used, inv = np.unique(tri.reshape(-1), return_inverse=True)
        md = MeshData(positions=(bm.positions[used] + bm.normals[used] * PATCH_LIFT_M).astype(np.float32),
                      normals=bm.normals[used], indices=inv.reshape(-1, 3).astype(np.uint32))
        out[patch_node_name(mid, side, role, bone)] = (
            md, {"kind": "patch", "muscle": mid, "side": side, "role": role, "bone": bone, "boneSide": bone_side})
    return out


def summarize(results: list[MuscleResult]) -> dict[str, dict]:
    """Manifest section: muscle -> side -> role -> list of {bone, areaCm2, center, tauMm}."""
    out: dict[str, dict] = {}
    for r in results:
        side = out.setdefault(r.muscle, {}).setdefault(r.side, {"origin": [], "insertion": [], "notes": r.notes})
        for p in r.patches:
            side[p.role].append({
                "bone": p.bone, "boneSide": p.bone_side, "areaCm2": round(p.area_cm2, 2),
                "center": [round(float(x), 4) for x in p.center], "tauMm": p.tau_mm, "source": p.source,
                "node": patch_node_name(p.muscle, p.side, p.role, p.bone),
            })
    return out


def main() -> None:
    from pipeline import scene as sc_mod

    a = an.load()
    sc = sc_mod.build()
    overrides = an.read_yaml("attachment_overrides.yaml") if (an.ANATOMY_DIR / "attachment_overrides.yaml").exists() else {}
    results, scores = run(sc, a, overrides, with_score=True)
    rows = []
    for r in results:
        if r.side != "r":
            continue
        ao = sum(p.area_cm2 for p in r.patches if p.role == "origin")
        ai = sum(p.area_cm2 for p in r.patches if p.role == "insertion")
        sc_ = scores.get((r.muscle, r.side))
        rows.append((r.muscle, ao, ai, sc_, r.notes))
    # anomalies first: missing roles, then low F1, then very large areas
    def key(row):
        _, ao, ai, s, _ = row
        return (0 if ao == 0 or ai == 0 else 1, s["f1"] if s else 2.0, -(ao + ai))
    print(f"{'muscle':<30}{'origin':>9}{'insertion':>11}   {'P':>5}{'R':>6}{'F1':>6}   notes")
    for mid, ao, ai, s, notes in sorted(rows, key=key):
        sc_txt = f"{s['precision']:5.2f}{s['recall']:6.2f}{s['f1']:6.2f}" if s else "    -     -     -"
        print(f"{mid:<30}{ao:8.1f} {ai:10.1f}   {sc_txt}   {'; '.join(notes)}")


if __name__ == "__main__":
    main()
