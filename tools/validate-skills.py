"""Validate the repository's simple skill frontmatter and local references offline.
This is structural validation; behavioral expectations are exercised in CRM gates.
"""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
skills = sorted((root / ".agents" / "skills").glob("*/SKILL.md"))
assert skills, "No project skills found"
for skill in skills:
    text = skill.read_text(encoding="utf-8")
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    assert match, f"{skill}: missing frontmatter"
    fields = dict(re.findall(r"^([a-z-]+): (.+)$", match.group(1), re.M))
    assert fields.get("name") == skill.parent.name, f"{skill}: name must match directory"
    assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", fields["name"]), f"{skill}: invalid name"
    assert fields.get("description", "").strip(), f"{skill}: missing description"
    assert len(text.splitlines()) <= 500, f"{skill}: split long guidance into references"
    assert re.search(r"(?im)^## (verification|validation|acceptance examples|evaluation cases)", text) or (skill.parent / "references" / "evaluation.json").is_file(), f"{skill}: missing verification"
    for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        if link.startswith(("http://", "https://", "#")):
            continue
        target = (skill.parent / link.split("#", 1)[0]).resolve()
        assert target.is_relative_to(root), f"{skill}: reference outside repository"
        assert target.is_file(), f"{skill}: broken reference {link}"
    for cases in [*skill.parent.glob("references/*cases.json"), *skill.parent.glob("references/evaluation.json")]:
        data = json.loads(cases.read_text(encoding="utf-8"))
        assert isinstance(data, list) and data, f"{cases}: empty evaluation cases"
        assert all(isinstance(case, dict) and (case.get("expected") or case.get("expect")) for case in data), f"{cases}: expected behavior required"
    print(f"PASS {skill.relative_to(root)}")
print(f"{len(skills)} project skills structurally valid; behavior remains a separate check.")
