#!/usr/bin/env python3
"""Validate the dependency-free static marketing site before deployment."""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
PROJECT_PREFIX = "/Open_Cowork/"
PRIVATE_IPV4 = re.compile(
    r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b"
)
TRACKER_MARKERS = (
    "google-analytics",
    "googletagmanager",
    "plausible.io",
    "posthog",
    "segment.com",
    "sentry.io",
    "hotjar",
    "mixpanel",
)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.h1_count = 0
        self.description = ""
        self.canonical = ""
        self.references: list[tuple[str, str]] = []
        self.json_ld: list[str] = []
        self._json_ld_buffer: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "meta" and values.get("name", "").lower() == "description":
            self.description = values.get("content", "").strip()
        elif tag == "link" and values.get("rel", "").lower() == "canonical":
            self.canonical = values.get("href", "").strip()
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._json_ld_buffer = []

        for attribute in ("href", "src"):
            value = values.get(attribute, "").strip()
            if value:
                self.references.append((attribute, value))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._json_ld_buffer is not None:
            self.json_ld.append("".join(self._json_ld_buffer).strip())
            self._json_ld_buffer = None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._json_ld_buffer is not None:
            self._json_ld_buffer.append(data)


def local_target(page: Path, reference: str) -> Path | None:
    parts = urlsplit(reference)
    if parts.scheme or parts.netloc or reference.startswith(("mailto:", "tel:", "#")):
        return None
    path = unquote(parts.path)
    if not path:
        return None
    if path.startswith(PROJECT_PREFIX):
        path = path[len(PROJECT_PREFIX) :]
        return SITE / (path or "index.html")
    if path.startswith("/"):
        return None
    target = (page.parent / path).resolve()
    if target.is_dir() or path.endswith("/"):
        target /= "index.html"
    return target


def validate_html(path: Path, errors: list[str]) -> None:
    text = path.read_text(encoding="utf-8")
    relative = path.relative_to(ROOT).as_posix()
    parser = PageParser()
    parser.feed(text)

    if not parser.title.strip():
        errors.append(f"{relative}: missing title")
    if parser.h1_count != 1:
        errors.append(f"{relative}: expected one h1, found {parser.h1_count}")
    if 'name="robots" content="noindex"' not in text:
        if not parser.description:
            errors.append(f"{relative}: missing meta description")
        if not parser.canonical.startswith("https://noshitcoding.github.io/Open_Cowork/"):
            errors.append(f"{relative}: missing or unexpected canonical URL")

    lowered = text.lower()
    for marker in TRACKER_MARKERS:
        if marker in lowered:
            errors.append(f"{relative}: tracker marker is not allowed: {marker}")
    if PRIVATE_IPV4.search(text):
        errors.append(f"{relative}: contains a private IPv4 address")

    for _, reference in parser.references:
        target = local_target(path, reference)
        if target is not None and not target.exists():
            errors.append(f"{relative}: broken local reference {reference!r}")

    for payload in parser.json_ld:
        try:
            json.loads(payload)
        except json.JSONDecodeError as error:
            errors.append(f"{relative}: invalid JSON-LD: {error.msg}")


def main() -> int:
    errors: list[str] = []
    required = (
        SITE / "index.html",
        SITE / "de" / "index.html",
        SITE / "privacy.html",
        SITE / "de" / "datenschutz.html",
        SITE / "robots.txt",
        SITE / "sitemap.xml",
        SITE / "assets" / "app-preview.png",
    )
    for path in required:
        if not path.exists():
            errors.append(f"missing required site file: {path.relative_to(ROOT).as_posix()}")

    for path in sorted(SITE.rglob("*.html")):
        validate_html(path, errors)

    robots = (SITE / "robots.txt").read_text(encoding="utf-8")
    if "Sitemap: https://noshitcoding.github.io/Open_Cowork/sitemap.xml" not in robots:
        errors.append("site/robots.txt: sitemap URL is missing")

    sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")
    for url in (
        "https://noshitcoding.github.io/Open_Cowork/",
        "https://noshitcoding.github.io/Open_Cowork/de/",
        "https://noshitcoding.github.io/Open_Cowork/privacy.html",
    ):
        if url not in sitemap:
            errors.append(f"site/sitemap.xml: missing {url}")

    if errors:
        print("Website validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Website validation passed ({len(list(SITE.rglob('*.html')))} HTML pages).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
