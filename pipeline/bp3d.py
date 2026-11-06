"""Parsers for BodyParts3D 4.0 metadata files.

Conventions observed in the 4.0 "isa" release:
- isa_element_parts.txt maps FMA concept -> element files (FJxxxx).
- A lateral structure has a right file FJnnnn and a mirrored left file FJnnnnM.
  Concepts named "right X" / "left X" map to exactly one of those.
"""
from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PartsDB:
    names: dict[str, str] = field(default_factory=dict)  # FMA id -> name
    elements: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    children: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))

    def find(self, name: str) -> list[str]:
        """FMA ids whose name equals `name` (case-insensitive)."""
        n = name.lower()
        return [k for k, v in self.names.items() if v.lower() == n]

    def search(self, substr: str) -> list[tuple[str, str]]:
        s = substr.lower()
        return sorted((k, v) for k, v in self.names.items() if s in v.lower())

    def descendants(self, fma: str) -> set[str]:
        out, stack = set(), [fma]
        while stack:
            for c in self.children.get(stack.pop(), []):
                if c not in out:
                    out.add(c)
                    stack.append(c)
        return out


def _rows(path: Path):
    with path.open(encoding="utf-8", newline="") as f:
        r = csv.reader(f, delimiter="\t")
        next(r, None)  # header
        for row in r:
            if row and row[0]:
                yield row


def load(cache_dir: Path, prefix: str = "isa") -> PartsDB:
    db = PartsDB()
    for row in _rows(cache_dir / f"{prefix}_parts_list_e.txt"):
        db.names[row[0]] = row[2]
    for row in _rows(cache_dir / f"{prefix}_element_parts.txt"):
        db.names.setdefault(row[0], row[1])
        db.elements[row[0]].append(row[2])
    rel = cache_dir / f"{prefix}_inclusion_relation_list.txt"
    if rel.exists():
        for row in _rows(rel):
            db.children[row[0]].append(row[2])
    return db


def side_of_element(fj: str) -> str:
    """'R' for FJnnnn, 'L' for mirrored FJnnnnM."""
    return "L" if fj.endswith("M") else "R"
