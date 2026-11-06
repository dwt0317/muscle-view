"""Rebuild every generated artefact from the sources, in dependency order.

Usage:  python -m pipeline.build [--skip-fetch] [--check]

    fetch          BodyParts3D 4.0 (parts lists / FMA ids; ~136 MB, slow server, resumable)
    za_extract     download Z-Anatomy.zip and export meshes with headless Blender (needs Blender 4.2)
    validate       anatomy/*.yaml against the schema and the meshes
    export         model.glb + manifest.json (+ compression check)
    golden         web/src/lib/kinematics.golden.json (keeps the web viewer's maths in sync)

--check only verifies that the generated files are newer than their inputs (CI-friendly, no recomputation).
"""
from __future__ import annotations

import argparse
import subprocess
import sys

from pipeline import validate as validate_mod
from pipeline.paths import ANATOMY_DIR, CACHE_DIR, ROOT, WEB_DATA_DIR

GENERATED = [WEB_DATA_DIR / "model.glb", WEB_DATA_DIR / "manifest.json", ROOT / "web" / "src" / "lib" / "kinematics.golden.json"]


def stale() -> list[str]:
    inputs = [p.stat().st_mtime for p in ANATOMY_DIR.glob("*.yaml")] + [p.stat().st_mtime for p in (ROOT / "pipeline").glob("*.py")]
    newest = max(inputs)
    out = []
    for g in GENERATED:
        if not g.exists():
            out.append(f"{g.relative_to(ROOT)}: missing")
        elif g.stat().st_mtime < newest:
            out.append(f"{g.relative_to(ROOT)}: older than its inputs")
    return out


def run(module: str, *args: str) -> None:
    print(f"\n=== python -m {module} {' '.join(args)}", flush=True)
    subprocess.run([sys.executable, "-m", module, *args], check=True, cwd=ROOT)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-fetch", action="store_true", help="BodyParts3D is only used for FMA ids; skip the download")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        problems = stale()
        print("\n".join(problems) or "generated files are up to date")
        return 1 if problems else 0

    if not args.skip_fetch and not (CACHE_DIR / "isa_parts_list_e.txt").exists():
        run("pipeline.fetch")
    run("pipeline.za_extract")
    if validate_mod.main() != 0:
        return 1
    run("pipeline.export", "--rebuild")
    run("pipeline.golden")
    print("\nDone. Next: cd web && npm install && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
