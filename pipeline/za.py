"""Access to the Z-Anatomy mesh export (data_cache/za) and FMA lookup via BodyParts3D.

Z-Anatomy object naming: "<English TA name>.r" / ".l" for lateral structures,
no suffix for midline ones. Attachment patches use ".or/.ol" (origin) and
".er/.el" (insertion), optionally numbered (".o2r"). Coordinates: metres, Z-up,
anterior = -Y, patient right = -X.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh

from pipeline import bp3d
from pipeline.paths import CACHE_DIR

ZA_DIR = CACHE_DIR / "za"
SKIN_DIR = CACHE_DIR / "za_skin"
SIDES = ("r", "l")


@lru_cache(maxsize=1)
def index() -> dict[str, dict]:
    path = ZA_DIR / "index.json"
    if not path.exists():
        raise SystemExit("Z-Anatomy export missing; run: python -m pipeline.za_extract")
    return {x["name"]: x for x in json.loads(path.read_text())}


def object_name(base: str, side: str | None) -> str:
    return f"{base}.{side}" if side else base


def has(base: str, side: str | None) -> bool:
    return object_name(base, side) in index()


def load_mesh(name: str, root: Path = ZA_DIR) -> trimesh.Trimesh:
    entry = index()[name] if root == ZA_DIR else None
    file = entry["file"] if entry else name
    m = trimesh.load(root / file, force="mesh", process=False)
    m.merge_vertices()
    return m


ATTACH_RE = re.compile(r"^(?P<base>.*)\.(?P<kind>[oe])(?P<n>\d*)(?P<side>[lr])?$")


def reference_patches(base: str, side: str | None) -> dict[str, list[dict]]:
    """Z-Anatomy hand-made attachment patches for a muscle (used for QA only)."""
    out: dict[str, list[dict]] = {"origin": [], "insertion": []}
    for name, e in index().items():
        if not e["collection"].startswith("2:"):
            continue
        m = ATTACH_RE.match(name)
        if not m or m["base"] != base or (m["side"] or None) != side:
            continue
        out["origin" if m["kind"] == "o" else "insertion"].append(e)
    return out


@lru_cache(maxsize=1)
def _bp3d_single() -> dict[str, tuple[str, str]]:
    """normalised BodyParts3D name -> (FMA id, name) for single-element concepts."""
    if not (CACHE_DIR / "isa_parts_list_e.txt").exists():
        return {}
    db = bp3d.load(CACHE_DIR)
    out = {}
    for fma, name in db.names.items():
        if len(db.elements.get(fma, [])) == 1 or name.lower() in ("sacrum", "coccyx"):
            out.setdefault(_norm(name), (fma, name))
    return out


def _norm(s: str) -> str:
    s = s.lower().replace("(", "").replace(")", "")
    s = re.sub(r"\b(muscle|muscles|bone)\b", "", s)
    s = s.replace("scapular spinal part", "spinal part").replace("colli", "cervicis")
    s = s.replace("external abdominal oblique", "external oblique")
    s = re.sub(r"\b(superior|inferior) gemellus\b", r"gemellus \1", s)
    s = re.sub(r"\bvertebra ([ltc])(\d+)\b", lambda m: _vert(m[1], int(m[2])), s)
    return re.sub(r"\s+", " ", s).strip()


_ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
        "ninth", "tenth", "eleventh", "twelfth"]


def _vert(kind: str, n: int) -> str:
    word = {"l": "lumbar", "t": "thoracic", "c": "cervical"}[kind]
    return f"{_ORD[n - 1]} {word} vertebra"


def fma_for(base: str, side: str | None) -> str | None:
    """Best-effort FMA id for a Z-Anatomy structure via BodyParts3D names."""
    table = _bp3d_single()
    side_word = {"r": "right", "l": "left"}.get(side or "", "")
    cands = []
    b = _norm(base)
    if side_word:
        cands.append(f"{side_word} {b}")
        m = re.match(r"(.* of )(.*)", b)
        if m:
            cands.append(f"{m[1]}{side_word} {m[2]}")
        m = re.match(r"(.* (?:head|part) )(?:of )?(.*)", b)
        if m:
            cands.append(f"{m[1]}of {side_word} {m[2]}")
        cands.append(f"{side_word} {b} muscle")
    cands.append(b)
    for c in cands:
        hit = table.get(re.sub(r"\s+", " ", c).strip())
        if hit:
            return hit[0]
    return None


def za_to_gltf(v: np.ndarray) -> np.ndarray:
    """Z-up/-Y-anterior (metres) -> glTF Y-up/+Z-anterior. Proper rotation (det=+1)."""
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], axis=-1)
