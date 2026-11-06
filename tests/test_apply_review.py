from pipeline import apply_review as ar

ATT = {
    "supraspinatus": {"r": {
        "origin": [{"bone": "scapula", "areaCm2": 35.0, "source": "algorithm"}],
        "insertion": [{"bone": "humerus", "areaCm2": 13.0, "source": "algorithm"}]}},
    "biceps_short": {"r": {"origin": [{"bone": "scapula", "areaCm2": 2.0, "source": "algorithm"}], "insertion": []}},
    "gluteus_medius": {"r": {
        "origin": [{"bone": "hip_bone", "areaCm2": 40.0, "source": "za"}],
        "insertion": [{"bone": "femur", "areaCm2": 4.0, "source": "za"}]}},
}


def review(*entries):
    return {"items": [{"muscle": m, "verdict": v, "note": n} for m, v, n in entries]}


def test_only_flagged_muscles_become_todos():
    todos = ar.build_todo(review(("supraspinatus", "ok", ""), ("biceps_short", "issue", "止点缺失")), ATT, {}, lambda m: False)
    assert [t.muscle for t in todos] == ["biceps_short"]


def test_too_large_suggests_a_smaller_threshold_and_uses_the_current_one():
    todos = ar.build_todo(review(("supraspinatus", "issue", "起点过大")), ATT, {"overrides": [{"muscle": "supraspinatus", "tau_mm": 4.0}]}, lambda m: False)
    (t,) = todos
    assert any("tau_mm: 2.4" in s for s in t.snippets)  # 4.0 * 0.6
    assert any("过大" in s for s in t.suggestions)


def test_missing_insertion_suggests_a_point_patch():
    (t,) = ar.build_todo(review(("biceps_short", "issue", "")), ATT, {}, lambda m: False)
    assert t.insertion_cm2 == 0
    assert any("add_point_patch" in s and "role: insertion" in s for s in t.snippets)


def test_hand_drawn_reference_is_offered_only_when_available_and_not_already_used():
    r = review(("supraspinatus", "issue", "范围不对"))
    (with_ref,) = ar.build_todo(r, ATT, {}, lambda m: True)
    assert "- {muscle: supraspinatus, source: za}" in with_ref.snippets
    (without,) = ar.build_todo(r, ATT, {}, lambda m: False)
    assert not any("source: za" in s for s in without.snippets)
    (already,) = ar.build_todo(review(("gluteus_medius", "issue", "x")), ATT, {"overrides": [{"muscle": "gluteus_medius", "source": "za"}]}, lambda m: True)
    assert not any("source: za" in s for s in already.snippets)
    assert already.source == "za"


def test_wrong_bone_points_to_the_anatomy_table():
    (t,) = ar.build_todo(review(("supraspinatus", "issue", "止点骨错了，应该在肱骨")), ATT, {}, lambda m: False)
    assert any("origin_bones" in s for s in t.suggestions)


def test_markdown_report_contains_the_snippets_and_handles_an_empty_review():
    todos = ar.build_todo(review(("biceps_short", "issue", "止点缺失")), ATT, {}, lambda m: False)
    md = ar.render_markdown(todos, 1, 1)
    assert "## biceps_short" in md and "```yaml" in md and "add_point_patch" in md
    assert "没有需要修正" in ar.render_markdown([], 3, 3)
