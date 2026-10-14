import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import prepare_site as ps  # noqa: E402

REPO = "https://github.com/daeungo1/ai-monitoring-govern"


def make_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    for rel, text in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return tmp_path


def build(tmp_path: Path, files: dict[str, str]) -> Path:
    root = make_repo(tmp_path, files)
    out = root / ".site-src"
    ps.prepare(root, out)
    return out


BASE = {
    "README.md": "---\ntitle: 홈\n---\n\n본문\n",
    "dailyreport.md": "---\ntitle: 보고서\n---\n\n본문\n",
    "AOAI_monitoring.md": "---\ntitle: 가이드\n---\n\n본문\n",
}


def test_readme_becomes_index_and_links_between_site_pages_stay_relative(tmp_path):
    out = build(tmp_path, {
        **BASE,
        "README.md": "---\ntitle: 홈\n---\n\n[가이드](docs/a.md) [보고서](dailyreport.md) ![그림](img/x.png)\n",
        "docs/a.md": "---\ntitle: A\n---\n\n[홈](../README.md) [보고서](../dailyreport.md) [b](b.md)\n",
        "docs/b.md": "---\ntitle: B\n---\n\nb\n",
        "img/x.png": "png",
    })
    index = (out / "index.md").read_text(encoding="utf-8")
    assert "[가이드](docs/a.md)" in index and "[보고서](dailyreport.md)" in index and "![그림](img/x.png)" in index
    a = (out / "docs/a.md").read_text(encoding="utf-8")
    assert "[홈](../index.md)" in a and "[보고서](../dailyreport.md)" in a and "[b](b.md)" in a
    assert not (out / "README.md").exists()
    assert (out / "img/x.png").exists()


def test_links_to_files_outside_the_site_point_to_github(tmp_path):
    out = build(tmp_path, {
        **BASE,
        "README.md": "---\ntitle: 홈\n---\n\n[설정](config/models.json) [폴더](tests) [KQL](queries/q.kql#top)\n",
        "config/models.json": "{}",
        "tests/a.test.mjs": "",
        "queries/q.kql": "print 1",
    })
    text = (out / "index.md").read_text(encoding="utf-8")
    assert f"[설정]({REPO}/blob/main/config/models.json)" in text
    assert f"[폴더]({REPO}/tree/main/tests)" in text
    assert "[KQL](queries/q.kql#top)" in text, "queries are copied into the site"


def test_external_anchor_mailto_and_fenced_code_are_untouched(tmp_path):
    body = "[웹](https://example.com/a) [앵커](#아래) [메일](mailto:a@b.c)\n\n```text\n[코드](missing/file.md)\n```\n"
    out = build(tmp_path, {**BASE, "README.md": f"---\ntitle: 홈\n---\n\n{body}"})
    text = (out / "index.md").read_text(encoding="utf-8")
    for expected in ("(https://example.com/a)", "(#아래)", "(mailto:a@b.c)", "[코드](missing/file.md)"):
        assert expected in text


def test_a_link_to_a_missing_file_fails_the_build_and_names_the_source(tmp_path):
    with pytest.raises(ps.SiteError) as error:
        build(tmp_path, {**BASE, "README.md": "---\ntitle: 홈\n---\n\n[없음](docs/nope.md)\n"})
    assert "README.md" in str(error.value) and "docs/nope.md" in str(error.value)


def test_github_alerts_become_admonitions(tmp_path):
    out = build(tmp_path, {**BASE, "README.md": (
        "---\ntitle: 홈\n---\n\n> [!IMPORTANT]\n> 첫 줄\n>\n> 둘째 줄\n\n다음 문단\n")})
    text = (out / "index.md").read_text(encoding="utf-8")
    assert '!!! important\n    첫 줄\n    \n    둘째 줄\n' in text
    assert "[!IMPORTANT]" not in text and "다음 문단" in text


def test_site_link_marker_line_is_removed_and_h1_is_added_from_title(tmp_path):
    out = build(tmp_path, {**BASE, "README.md": (
        "---\ntitle: 홈 제목\n---\n\n<!-- site-link -->[사이트](https://x.github.io/)\n\n## 소제목\n")})
    text = (out / "index.md").read_text(encoding="utf-8")
    assert "site-link" not in text and "x.github.io" not in text
    assert "\n# 홈 제목\n" in text
    own_h1 = build(tmp_path / "second", {**BASE, "README.md": "---\ntitle: 제목\n---\n\n# 이미 있음\n"})
    assert (own_h1 / "index.md").read_text(encoding="utf-8").count("\n# ") == 1


def test_stale_output_is_removed_before_assembling(tmp_path):
    root = make_repo(tmp_path, {**BASE, "docs/a.md": "---\ntitle: A\n---\n\na\n"})
    out = root / ".site-src"
    (out / "old.md").parent.mkdir(parents=True, exist_ok=True)
    (out / "old.md").write_text("stale", encoding="utf-8")
    ps.prepare(root, out)
    assert not (out / "old.md").exists() and (out / "docs/a.md").exists()


SPLIT_README = """---
title: 홈
---

## 소개

소개 본문 [문서](docs/a.md)

## 요건 1

<!-- site-page: usage/metrics.md -->
### 1-1. 메트릭

메트릭 본문 [문서](docs/a.md) ![그림](img/x.png)

#### 세부

세부 본문

```powershell
# 코드 주석은 제목이 아니다
Get-Date
```

<!-- site-page: usage/cost.md -->
### 1-2. 비용

비용 본문 [홈](README.md) [설정](config/models.json)

## 요건 2

<!-- site-page: guard/concept.md -->
### 2-1. 개념

개념 본문
"""
SPLIT_FILES = {**BASE, "README.md": SPLIT_README, "docs/a.md": "---\ntitle: A\n---\n\na\n",
               "img/x.png": "png", "config/models.json": "{}"}


def test_site_page_markers_split_the_readme_into_pages(tmp_path):
    out = build(tmp_path, SPLIT_FILES)
    index = (out / "index.md").read_text(encoding="utf-8")
    assert "소개 본문" in index and "메트릭 본문" not in index
    assert "site-page" not in index
    for page in ("usage/metrics.md", "usage/cost.md", "guard/concept.md"):
        assert (out / page).exists(), page
        assert "site-page" not in (out / page).read_text(encoding="utf-8")


def test_organizer_headings_before_a_marker_are_dropped_from_the_previous_page(tmp_path):
    out = build(tmp_path, SPLIT_FILES)
    assert "요건 1" not in (out / "index.md").read_text(encoding="utf-8")
    assert "요건 2" not in (out / "usage/cost.md").read_text(encoding="utf-8")


def test_split_pages_promote_the_first_heading_to_h1_and_keep_relative_depth(tmp_path):
    out = build(tmp_path, SPLIT_FILES)
    metrics = (out / "usage/metrics.md").read_text(encoding="utf-8")
    assert metrics.lstrip().startswith("# 1-1. 메트릭")
    assert "\n## 세부\n" in metrics and "####" not in metrics
    assert "# 코드 주석은 제목이 아니다" in metrics, "fenced comments must not be re-leveled"


def test_links_in_split_pages_are_relative_to_the_new_page_location(tmp_path):
    out = build(tmp_path, SPLIT_FILES)
    metrics = (out / "usage/metrics.md").read_text(encoding="utf-8")
    assert "[문서](../docs/a.md)" in metrics and "![그림](../img/x.png)" in metrics
    cost = (out / "usage/cost.md").read_text(encoding="utf-8")
    assert "[홈](../index.md)" in cost and f"[설정]({REPO}/blob/main/config/models.json)" in cost
    assert "[문서](docs/a.md)" in (out / "index.md").read_text(encoding="utf-8")


def test_a_titled_marker_adds_one_h1_and_keeps_the_section_levels(tmp_path):
    readme = ("---\ntitle: 홈\n---\n\n## 소개\n\n본문\n\n"
              "<!-- site-page: ops/arch.md 구성과 검증 -->\n"
              "## 구성\n\n구성 본문\n\n## 검증\n\n검증 본문\n")
    out = build(tmp_path, {**BASE, "README.md": readme})
    page = (out / "ops/arch.md").read_text(encoding="utf-8")
    assert page.startswith("# 구성과 검증\n")
    assert len(re.findall(r"^# ", page, re.MULTILINE)) == 1, "exactly one H1"
    assert "\n## 구성\n" in page and "\n## 검증\n" in page
    assert "site-page" not in page


def test_duplicate_or_unsafe_site_page_markers_fail_the_build(tmp_path):
    duplicate = SPLIT_README.replace("usage/cost.md", "usage/metrics.md")
    with pytest.raises(ps.SiteError):
        build(tmp_path / "dup", {**SPLIT_FILES, "README.md": duplicate})
    escaping = SPLIT_README.replace("usage/cost.md", "../outside.md")
    with pytest.raises(ps.SiteError):
        build(tmp_path / "esc", {**SPLIT_FILES, "README.md": escaping})


def test_links_to_git_ignored_files_fail_like_they_do_in_a_clean_checkout(tmp_path):
    import shutil
    import subprocess
    if shutil.which("git") is None:
        pytest.skip("git is required")
    root = make_repo(tmp_path, {
        **BASE,
        "README.md": "---\ntitle: 홈\n---\n\n[로컬 증거](artifacts/result.json)\n",
        ".gitignore": "artifacts/\n",
        "artifacts/result.json": "{}",
    })
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    with pytest.raises(ps.SiteError) as error:
        ps.prepare(root, root / ".site-src")
    assert "artifacts/result.json" in str(error.value)


def test_untracked_but_not_ignored_files_are_still_linkable(tmp_path):
    import shutil
    import subprocess
    if shutil.which("git") is None:
        pytest.skip("git is required")
    root = make_repo(tmp_path, {
        **BASE,
        "README.md": "---\ntitle: 홈\n---\n\n[새 파일](config/new.json) [폴더](config)\n",
        "config/new.json": "{}",
    })
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    out = root / ".site-src"
    ps.prepare(root, out)
    text = (out / "index.md").read_text(encoding="utf-8")
    assert f"{REPO}/blob/main/config/new.json" in text and f"{REPO}/tree/main/config" in text


def test_every_prepared_page_is_reachable_from_the_real_navigation(tmp_path):
    repo = Path(__file__).resolve().parents[2]
    text = (repo / "mkdocs.yml").read_text(encoding="utf-8")
    nav_block = text.split("\nnav:\n", 1)[1].split("\ncopyright:", 1)[0]
    listed = set(re.findall(r":\s+([\w./-]+\.md)\s*$", nav_block, re.MULTILINE))
    pages = {page for page in ps.prepare(repo, tmp_path / "src") if page.endswith(".md")}
    assert pages == listed, f"not in nav: {sorted(pages - listed)}; nav without page: {sorted(listed - pages)}"

