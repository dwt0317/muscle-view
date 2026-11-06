"""Loaders for the hand-maintained anatomy tables (anatomy/*.yaml)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from pipeline.paths import ANATOMY_DIR

SIDES = ("r", "l")


def read_yaml(name: str, base: Path | None = None) -> dict:
    return yaml.safe_load(((base or ANATOMY_DIR) / name).read_text(encoding="utf-8"))


@dataclass
class Bone:
    id: str
    sided: bool
    body: str
    regions: list[str]
    name: dict[str, str]
    za: list[str] = field(default_factory=list)
    za_re: str | None = None
    context: bool = False

    def node(self, side: str | None) -> str:
        return f"b_{self.id}_{side}" if side else f"b_{self.id}"

    def sides(self) -> tuple[str | None, ...]:
        return SIDES if self.sided else (None,)

    def resolve(self, za_index: dict[str, dict], side: str | None) -> list[str]:
        """Z-Anatomy skeletal mesh names that make up this bone for the given side."""
        if self.za_re:
            rx = re.compile(self.za_re.replace("{s}", side if side else "(?:r|l)"))
            cand = [n for n, e in za_index.items() if e["collection"].startswith("1:")]
            return sorted(n for n in cand if rx.match(n))
        out = [f"{n}.{side}" if side else n for n in self.za]
        return [n for n in out if n in za_index]


@dataclass
class Muscle:
    id: str
    za: str
    regions: list[str]
    group: str
    layer: str
    name: dict[str, str]
    origin: dict[str, str]
    insertion: dict[str, str]
    origin_bones: list[str]
    insertion_bones: list[str]
    function: dict[str, str]
    kind: str = "muscle"
    tendinous: bool = False
    via: dict | None = None

    def node(self, side: str) -> str:
        return f"m_{self.id}_{side}"

    def za_name(self, side: str) -> str:
        return f"{self.za}.{side}"


@dataclass
class Anatomy:
    regions: dict[str, dict[str, str]]
    bones: list[Bone]
    muscles: list[Muscle]
    groups: dict[str, dict[str, str]]

    def bone(self, bid: str) -> Bone:
        return next(b for b in self.bones if b.id == bid)

    def muscle(self, mid: str) -> Muscle:
        return next(m for m in self.muscles if m.id == mid)


def parse(bones_doc: dict, muscles_doc: dict) -> Anatomy:
    bones = [Bone(**b) for b in bones_doc["bones"]]
    muscles = [Muscle(**m) for m in muscles_doc["muscles"]]
    return Anatomy(bones_doc["regions"], bones, muscles, muscles_doc["groups"])


@lru_cache(maxsize=1)
def load() -> Anatomy:
    return parse(read_yaml("bones.yaml"), read_yaml("muscles.yaml"))
