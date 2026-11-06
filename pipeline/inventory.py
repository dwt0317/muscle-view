"""List candidate BodyParts3D structures for the four target regions.

Usage: python -m pipeline.inventory [--region shoulder]
"""
from __future__ import annotations

import argparse

from pipeline import bp3d
from pipeline.paths import CACHE_DIR, OBJ_DIR

REGION_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "shoulder": {
        "bone": ["scapula", "clavicle", "humerus", "sternum", "rib"],
        "muscle": [
            "deltoid", "supraspinatus", "infraspinatus", "teres", "subscapularis",
            "pectoralis", "latissimus", "trapezius", "rhomboid", "serratus anterior",
            "levator scapulae", "coracobrachialis", "biceps brachii", "triceps brachii",
        ],
    },
    "hip": {
        "bone": ["hip bone", "sacrum", "coccyx", "femur"],
        "muscle": [
            "gluteus", "tensor fasciae latae", "piriformis", "gemellus", "obturator",
            "quadratus femoris", "iliacus", "psoas", "adductor", "pectineus", "gracilis",
            "sartorius",
        ],
    },
    "knee": {
        "bone": ["femur", "tibia", "fibula", "patella"],
        "muscle": [
            "rectus femoris", "vastus", "biceps femoris", "semitendinosus",
            "semimembranosus", "popliteus", "gastrocnemius", "plantaris", "soleus",
        ],
    },
    "lumbar": {
        "bone": ["lumbar vertebra", "thoracic vertebra", "intervertebral disk of"],
        "muscle": [
            "erector", "iliocostalis", "longissimus", "spinalis", "multifidus",
            "quadratus lumborum", "rectus abdominis", "external oblique", "internal oblique",
            "transversus abdominis", "rotatores", "intertransvers", "interspinal",
        ],
    },
}

SKIN_FMA = "FMA7163"


def candidates(db: bp3d.PartsDB, keywords: list[str]) -> list[tuple[str, str, list[str]]]:
    out = []
    for fma, name in sorted(db.names.items(), key=lambda kv: kv[1]):
        if not any(k in name.lower() for k in keywords):
            continue
        els = db.elements.get(fma, [])
        if els:
            out.append((fma, name, els))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", choices=list(REGION_KEYWORDS))
    args = ap.parse_args()
    db = bp3d.load(CACHE_DIR)
    have = {p.stem for p in OBJ_DIR.glob("*.obj")} if OBJ_DIR.exists() else set()
    for region, kinds in REGION_KEYWORDS.items():
        if args.region and region != args.region:
            continue
        print(f"\n===== {region} =====")
        for kind, kws in kinds.items():
            rows = candidates(db, kws)
            print(f"-- {kind} ({len(rows)} concepts)")
            for fma, name, els in rows:
                miss = [e for e in els if have and e not in have]
                flag = f"  MISSING {miss}" if miss else ""
                print(f"  {fma:<11} {name:<55} {' '.join(els[:4])}{' …' if len(els) > 4 else ''}{flag}")
    skin = db.elements.get(SKIN_FMA, [])
    present = bool(skin) and (not have or all(e in have for e in skin))
    print(f"\nBodyParts3D skin {SKIN_FMA}: elements={skin} present={'YES' if present else 'NO'}")

    # Z-Anatomy (derived from BodyParts3D, adds muscles BP3D 4.0 lacks)
    from pipeline import za
    try:
        ix = za.index()
    except SystemExit:
        print("Z-Anatomy export: not found (run python -m pipeline.za_extract)")
        return
    missing_in_bp3d = ["Latissimus dorsi muscle", "Multifidus lumborum muscle",
                       "Quadratus lumborum muscle", "Rectus abdominis muscle",
                       "Internal abdominal oblique muscle", "Transversus abdominis muscle"]
    print(f"\nZ-Anatomy meshes: {len(ix)}")
    for b in missing_in_bp3d:
        print(f"  {b:<40} bp3d={'yes' if db.find('right ' + b.replace(' muscle', '').lower()) else 'NO '} "
              f"z-anatomy={'yes' if za.has(b, 'r') else 'NO'}")
    skin_ix = za.SKIN_DIR / "index.json"
    print(f"Z-Anatomy skin regions: {'YES' if skin_ix.exists() else 'NO'} ({skin_ix})")


if __name__ == "__main__":
    main()
