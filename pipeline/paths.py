from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data_cache"
OBJ_DIR = CACHE_DIR / "obj"
ANATOMY_DIR = ROOT / "anatomy"
WEB_DATA_DIR = ROOT / "web" / "public" / "data"
BUILD_DIR = CACHE_DIR / "build"
