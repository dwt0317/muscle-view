from pathlib import Path

from pipeline import bp3d, inventory

FIX = Path(__file__).parent / "fixtures"


def test_parse_parts_list():
    db = bp3d.load(FIX)
    assert db.names["FMA32544"] == "right supraspinatus"
    assert db.elements["FMA9629"] == ["FJ1506", "FJ1506M"]
    assert db.find("Right Supraspinatus") == ["FMA32544"]
    assert db.descendants("FMA9629") == {"FMA32544", "FMA32545"}


def test_side_of_element():
    assert bp3d.side_of_element("FJ1506") == "R"
    assert bp3d.side_of_element("FJ1506M") == "L"


def test_inventory_candidates_and_skin():
    db = bp3d.load(FIX)
    rows = inventory.candidates(db, ["supraspinatus"])
    assert [r[0] for r in rows] == ["FMA32545", "FMA32544", "FMA9629"]
    assert db.elements[inventory.SKIN_FMA] == ["FJ2810"]
