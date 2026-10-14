"""Assemble the MkDocs source tree for the GitHub Pages site.

The documentation lives in the repository root (README.md, dailyreport.md,
AOAI_monitoring.md) and in docs/, img/ and queries/. MkDocs needs one docs
directory, so this script copies those files into ``.site-src`` and rewrites
links that would otherwise break:

* README.md is published as the site home (index.md).
* Links to files that exist in the repository but not in the site become
  GitHub blob/tree links.
* GitHub alert blockquotes (``> [!NOTE]``) become Material admonitions.
* A link to a file that exists nowhere fails the build.
"""
from __future__ import annotations

import posixpath
import re
import shutil
import sys
from pathlib import Path

REPO_URL = "https://github.com/daeungo1/ai-monitoring-govern"
BRANCH = "main"
ROOT_PAGES = {"README.md": "index.md", "dailyreport.md": "dailyreport.md", "AOAI_monitoring.md": "AOAI_monitoring.md"}
SITE_DIRS = ("docs", "img", "queries")
SITE_LINK_MARKER = "<!-- site-link -->"
PAGE_MARKER = re.compile(r"^<!-- site-page: (\S+\.md)(?: (.+?))? -->\s*$")
HEADING = re.compile(r"^(#{1,6}) (.*)$")

LINK = re.compile(r"(!?\[[^\]]*\]\()(<[^>]+>|[^)\s]+)((?:\s+\"[^\"]*\")?\))")
ALERT = re.compile(r"^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$")
ALERT_TYPES = {"NOTE": "note", "TIP": "tip", "IMPORTANT": "important", "WARNING": "warning", "CAUTION": "caution"}
FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


class SiteError(Exception):
    pass


def site_path(rel: str) -> str:
    return ROOT_PAGES.get(rel, rel)


def collect_sources(root: Path) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    for name in ROOT_PAGES:
        if (root / name).is_file():
            sources[name] = root / name
    for directory in SITE_DIRS:
        base = root / directory
        if base.is_dir():
            for path in sorted(base.rglob("*")):
                if path.is_file():
                    sources[path.relative_to(root).as_posix()] = path
    return sources


def rewrite_target(target: str, source_rel: str, out_rel: str, root: Path, sources: dict[str, Path]) -> str:
    wrapped = target.startswith("<") and target.endswith(">")
    raw = target[1:-1] if wrapped else target
    if raw.startswith(("http://", "https://", "mailto:", "#")) or "://" in raw:
        return target
    path_part, hash_sep, fragment = raw.partition("#")
    if not path_part:
        return target
    resolved = (root / posixpath.dirname(source_rel) / path_part).resolve()
    try:
        rel = resolved.relative_to(root.resolve()).as_posix()
    except ValueError as error:
        raise SiteError(f"{source_rel}: link leaves the repository: {raw}") from error
    if rel in sources:
        link = posixpath.relpath(site_path(rel), posixpath.dirname(out_rel) or ".")
    elif resolved.is_dir():
        link = f"{REPO_URL}/tree/{BRANCH}/{rel}"
    elif resolved.is_file():
        link = f"{REPO_URL}/blob/{BRANCH}/{rel}"
    else:
        raise SiteError(f"{source_rel}: broken link: {raw}")
    result = f"{link}{hash_sep}{fragment}"
    return f"<{result}>" if wrapped else result


def convert_alerts(lines: list[str]) -> list[str]:
    output: list[str] = []
    index = 0
    while index < len(lines):
        match = ALERT.match(lines[index])
        if not match:
            output.append(lines[index])
            index += 1
            continue
        output.append(f"!!! {ALERT_TYPES[match.group(1)]}")
        index += 1
        while index < len(lines) and lines[index].startswith(">"):
            content = lines[index][2:] if lines[index].startswith("> ") else lines[index][1:]
            output.append(f"    {content}")
            index += 1
    return output


def split_pages(lines: list[str], default_out: str, source_rel: str) -> list[tuple[str, str | None, list[str]]]:
    """Split on ``<!-- site-page: path.md [Page title] -->`` markers.

    Content before the first marker belongs to ``default_out``. A heading that
    is the last thing before a marker only organizes the sections that follow
    on GitHub, so it is dropped from the page it would otherwise end.
    """
    pages: list[tuple[str, str | None, list[str]]] = [(default_out, None, [])]
    seen = {default_out}
    for line in lines:
        marker = PAGE_MARKER.match(line)
        if not marker:
            pages[-1][2].append(line)
            continue
        target = marker.group(1)
        if target in seen or posixpath.normpath(target) != target or target.startswith(("/", "..")):
            raise SiteError(f"{source_rel}: invalid or duplicate site-page marker: {target}")
        seen.add(target)
        previous = pages[-1][2]
        while previous and not previous[-1].strip():
            previous.pop()
        if previous and HEADING.match(previous[-1]):
            previous.pop()
        pages.append((target, marker.group(2), []))
    return pages


def promote_headings(lines: list[str]) -> list[str]:
    levels: list[int] = []
    in_fence = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence and (match := HEADING.match(line)):
            levels.append(len(match.group(1)))
    shift = (levels[0] - 1) if levels else 0
    if shift <= 0:
        return lines
    result: list[str] = []
    in_fence = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence and (match := HEADING.match(line)):
            line = f"{'#' * max(1, len(match.group(1)) - shift)} {match.group(2)}"
        result.append(line)
    return result


def render_page(lines: list[str], source_rel: str, out_rel: str, root: Path, sources: dict[str, Path],
                front: str, title: str | None) -> str:
    result: list[str] = []
    in_fence = False
    has_h1 = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence:
            if line.startswith("# "):
                has_h1 = True
            line = LINK.sub(
                lambda m: f"{m.group(1)}{rewrite_target(m.group(2), source_rel, out_rel, root, sources)}{m.group(3)}", line)
        result.append(line)
    body = "\n".join(result).strip("\n")
    if title and not has_h1:
        body = f"# {title}\n\n{body}"
    return f"{front}\n{body}\n" if front else f"{body}\n"


def transform(text: str, source_rel: str, root: Path, sources: dict[str, Path]) -> dict[str, str]:
    """Return ``{site path: markdown}`` for one source file."""
    text = text.replace("\r\n", "\n")
    match = FRONT_MATTER.match(text)
    front, body = (match.group(0), text[match.end():]) if match else ("", text)
    title = None
    if match:
        found = re.search(r"^title:\s*(.+?)\s*$", match.group(1), re.MULTILINE)
        title = found.group(1).strip("\"'") if found else None

    lines = [line for line in body.split("\n") if SITE_LINK_MARKER not in line]
    lines = convert_alerts(lines)
    default_out = site_path(source_rel)
    pages: dict[str, str] = {}
    for index, (out_rel, page_title, page_lines) in enumerate(split_pages(lines, default_out, source_rel)):
        if index == 0:
            pages[out_rel] = render_page(page_lines, source_rel, out_rel, root, sources, front, title)
        elif page_title:
            pages[out_rel] = render_page(page_lines, source_rel, out_rel, root, sources, "", page_title)
        else:
            pages[out_rel] = render_page(promote_headings(page_lines), source_rel, out_rel, root, sources, "", None)
    return pages


def prepare(root: Path, out: Path) -> list[str]:
    root = root.resolve()
    if out.exists():
        shutil.rmtree(out)
    sources = collect_sources(root)
    if "README.md" not in sources:
        raise SiteError("README.md is required as the site home page.")
    written: set[str] = set()
    for rel, path in sources.items():
        if rel.endswith(".md"):
            for out_rel, markdown in transform(path.read_text(encoding="utf-8"), rel, root, sources).items():
                if out_rel in written:
                    raise SiteError(f"{rel}: site page already produced by another source: {out_rel}")
                target = out / out_rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(markdown, encoding="utf-8", newline="\n")
                written.add(out_rel)
        else:
            target = out / site_path(rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            written.add(site_path(rel))
    return sorted(written)


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    try:
        pages = prepare(root, root / ".site-src")
    except SiteError as error:
        print(f"Site preparation failed: {error}", file=sys.stderr)
        return 1
    print(f"Prepared {len(pages)} site files in .site-src")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
