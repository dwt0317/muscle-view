"""Download BodyParts3D 4.0 data (OBJ zip + parts lists) into data_cache/.

The DBCLS server is slow and drops long connections, so the zip is fetched
with parallel HTTP range requests, each chunk resumable and retried.

Usage: python -m pipeline.fetch [--workers 16]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import time
import zipfile
from pathlib import Path

import requests

from pipeline.paths import CACHE_DIR, OBJ_DIR

BASE = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"
ZIP_NAME = "isa_BP3D_4.0_obj_99.zip"
ZIP_SIZE = 142903898
TEXT_FILES = [
    "isa_parts_list_e.txt",
    "isa_element_parts.txt",
    "isa_inclusion_relation_list.txt",
    "partof_parts_list_e.txt",
    "partof_element_parts.txt",
    "partof_inclusion_relation_list.txt",
]
CHUNK = 2 * 1024 * 1024


def _get_range(url: str, start: int, end: int, part: Path, retries: int = 50) -> None:
    """Download bytes [start, end] into part file, resuming on failure."""
    want = end - start + 1
    for attempt in range(retries):
        have = part.stat().st_size if part.exists() else 0
        if have >= want:
            return
        try:
            r = requests.get(
                url,
                headers={"Range": f"bytes={start + have}-{end}"},
                stream=True,
                timeout=60,
            )
            if r.status_code != 206:
                raise RuntimeError(f"unexpected status {r.status_code}")
            with part.open("ab") as f:
                for block in r.iter_content(64 * 1024):
                    f.write(block)
        except Exception as e:  # noqa: BLE001 - network errors are retried
            time.sleep(min(30, 2 + attempt))
            last = e
    else:
        raise RuntimeError(f"chunk {start}-{end} failed: {last}")


def download_zip(workers: int) -> Path:
    dest = CACHE_DIR / ZIP_NAME
    if dest.exists() and dest.stat().st_size == ZIP_SIZE:
        return dest
    parts_dir = CACHE_DIR / "zip_parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    url = f"{BASE}/{ZIP_NAME}"
    ranges = [(s, min(s + CHUNK, ZIP_SIZE) - 1) for s in range(0, ZIP_SIZE, CHUNK)]
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {
            ex.submit(_get_range, url, s, e, parts_dir / f"{i:05d}.part"): i
            for i, (s, e) in enumerate(ranges)
        }
        done = 0
        for fut in cf.as_completed(futs):
            fut.result()
            done += 1
            print(f"chunk {done}/{len(ranges)}", flush=True)
    tmp = dest.with_suffix(".tmp")
    with tmp.open("wb") as out:
        for i in range(len(ranges)):
            out.write((parts_dir / f"{i:05d}.part").read_bytes())
    if tmp.stat().st_size != ZIP_SIZE:
        raise RuntimeError("assembled size mismatch")
    tmp.rename(dest)
    for p in parts_dir.iterdir():
        p.unlink()
    parts_dir.rmdir()
    return dest


def download_text() -> None:
    for name in TEXT_FILES:
        dest = CACHE_DIR / name
        if dest.exists() and dest.stat().st_size > 0:
            continue
        r = requests.get(f"{BASE}/{name}", timeout=120)
        r.raise_for_status()
        dest.write_bytes(r.content)


def extract(zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"corrupt member {bad}")
        OBJ_DIR.mkdir(parents=True, exist_ok=True)
        for info in z.infolist():
            if info.filename.endswith(".obj"):
                (OBJ_DIR / Path(info.filename).name).write_bytes(z.read(info))


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    download_text()
    z = download_zip(args.workers)
    print("sha256", sha256(z))
    extract(z)
    print("objs:", len(list(OBJ_DIR.glob("*.obj"))))


if __name__ == "__main__":
    main()
