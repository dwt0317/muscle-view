import copy

import pytest

from pipeline import anatomy as an
from pipeline import validate as v
from pipeline.paths import CACHE_DIR

NAME = {"zh": "冈上肌", "en": "Supraspinatus", "la": "M. supraspinatus"}
TXT = {"zh": "文", "en": "text"}

BONES = {
    "regions": {"shoulder": {"zh": "肩", "en": "Shoulder", "la": "Articulatio humeri"}},
    "bones": [
        {"id": "scapula", "za": ["Scapula"], "sided": True, "body": "scapula", "regions": ["shoulder"],
         "name": {"zh": "肩胛骨", "en": "Scapula", "la": "Scapula"}},
        {"id": "humerus", "za": ["Humerus"], "sided": True, "body": "humerus", "regions": ["shoulder"],
         "name": {"zh": "肱骨", "en": "Humerus", "la": "Humerus"}},
        {"id": "ribs", "za_re": r"^(First|Second) rib\.{s}$", "sided": True, "body": "thorax",
         "regions": ["shoulder"], "name": {"zh": "肋", "en": "Ribs", "la": "Costae"}},
    ],
}
MUSCLES = {
    "groups": {"rotator_cuff": {"zh": "肩袖", "en": "Rotator cuff"}},
    "muscles": [
        {"id": "supraspinatus", "za": "Supraspinatus muscle", "regions": ["shoulder"], "group": "rotator_cuff",
         "layer": "deep", "name": NAME, "origin": TXT, "insertion": TXT, "function": TXT,
         "origin_bones": ["scapula"], "insertion_bones": ["humerus"]},
    ],
}
ZA = {
    n: {"collection": c}
    for n, c in [
        ("Scapula.r", "1: Skeletal system"), ("Scapula.l", "1: Skeletal system"),
        ("Humerus.r", "1: Skeletal system"), ("Humerus.l", "1: Skeletal system"),
        ("First rib.r", "1: Skeletal system"), ("Second rib.r", "1: Skeletal system"),
        ("First rib.l", "1: Skeletal system"),
        ("Supraspinatus muscle.r", "4: Muscular system"), ("Supraspinatus muscle.l", "4: Muscular system"),
    ]
}


def run(bones=BONES, muscles=MUSCLES, za=ZA):
    return v.validate(an.parse(copy.deepcopy(bones), copy.deepcopy(muscles)), za)


def errors(issues):
    return [str(i) for i in issues if i.level == "error"]


def test_valid_sample_has_no_errors():
    assert errors(run()) == []


def test_bone_regex_resolves_sides():
    a = an.parse(BONES, MUSCLES)
    ribs = a.bone("ribs")
    assert ribs.resolve(ZA, "r") == ["First rib.r", "Second rib.r"]
    assert ribs.resolve(ZA, "l") == ["First rib.l"]


@pytest.mark.parametrize(
    "mutate, needle",
    [
        (lambda m: m["muscles"][0].update(group="nope"), "unknown group"),
        (lambda m: m["muscles"][0].update(layer="middle"), "layer must be"),
        (lambda m: m["muscles"][0]["name"].pop("la"), "missing name.la"),
        (lambda m: m["muscles"][0]["origin"].update(zh=""), "missing origin.zh"),
        (lambda m: m["muscles"][0].update(origin_bones=["ghost"]), "unknown bone 'ghost'"),
        (lambda m: m["muscles"][0].update(insertion_bones=[]), "insertion_bones is empty"),
        (lambda m: m["muscles"][0].update(za="Missing muscle"), "not found"),
        (lambda m: m["muscles"][0].update(regions=["knee"]), "unknown region"),
        (lambda m: m["muscles"].append(copy.deepcopy(m["muscles"][0])), "duplicate id"),
    ],
)
def test_muscle_errors(mutate, needle):
    muscles = copy.deepcopy(MUSCLES)
    mutate(muscles)
    assert any(needle in e for e in errors(run(muscles=muscles))), errors(run(muscles=muscles))


def test_muscle_mesh_must_be_in_muscular_collection():
    za = copy.deepcopy(ZA)
    za["Supraspinatus muscle.r"]["collection"] = "1: Skeletal system"
    assert any("not in the muscular system" in e for e in errors(run(za=za)))


def test_bone_without_mesh_is_error():
    za = {k: v_ for k, v_ in ZA.items() if k != "Humerus.l"}
    assert any("no Z-Anatomy mesh" in e for e in errors(run(za=za)))


def test_same_mesh_in_two_bones_is_error():
    bones = copy.deepcopy(BONES)
    bones["bones"].append({**bones["bones"][0], "id": "scapula2"})
    assert any("already used" in e for e in errors(run(bones=bones)))


def test_coverage_report_counts():
    lines = v.coverage(an.parse(BONES, MUSCLES), ZA)
    assert lines[1].startswith("shoulder") and "100%" in lines[1]


@pytest.mark.skipif(not (CACHE_DIR / "za" / "index.json").exists(), reason="Z-Anatomy export not present")
def test_real_tables_are_valid():
    from pipeline import za

    assert errors(v.validate(an.load(), za.index())) == []
