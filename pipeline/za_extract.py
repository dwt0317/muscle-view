"""Unpack Z-Anatomy and export its meshes with headless Blender.

Usage: python -m pipeline.za_extract
Env:   BLENDER=/path/to/blender (default: ~/opt/blender-4.2*/blender or `blender` on PATH)
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

import requests

from pipeline.paths import CACHE_DIR, ROOT

ZA_URL = "https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/master/Z-Anatomy.zip"
ZA_ZIP = CACHE_DIR / "Z-Anatomy.zip"
ZA_BLEND = CACHE_DIR / "Z-Anatomy" / "Startup.blend"
ZA_OUT = CACHE_DIR / "za"
ZA_SKIN = CACHE_DIR / "za_skin"


def find_blender() -> str:
    if os.environ.get("BLENDER"):
        return os.environ["BLENDER"]
    hits = sorted(glob.glob(os.path.expanduser("~/opt/blender-4.2*/blender")))
    if hits:
        return hits[-1]
    exe = shutil.which("blender")
    if not exe:
        raise SystemExit("Blender not found; set BLENDER=/path/to/blender (4.2 LTS tested)")
    return exe


def main() -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    if not ZA_ZIP.exists():
        with requests.get(ZA_URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            with ZA_ZIP.open("wb") as f:
                shutil.copyfileobj(r.raw, f)
    if not ZA_BLEND.exists():
        with zipfile.ZipFile(ZA_ZIP) as z:
            z.extractall(CACHE_DIR)
    jobs = [(ZA_OUT, None), (ZA_SKIN, "9: Regions of human body")]
    for out, cols in jobs:
        if (out / "index.json").exists():
            print("already exported:", out)
            continue
        cmd = [find_blender(), "-b", str(ZA_BLEND), "--python",
               str(ROOT / "pipeline" / "blender_export.py"), "--", str(out)]
        if cols:
            cmd.append(cols)
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        print("exported:", out)


if __name__ == "__main__":
    main()
