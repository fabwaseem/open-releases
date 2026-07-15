from __future__ import annotations

import re
from typing import Iterable

# Installer / app package heuristics for the catalog.
_ASSET_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "android",
        re.compile(
            r"(?i)("
            r"\.apk$|\.aab$|"
            r"[-_.](android|android-arm64|android-arm|android-x86|android-x86_64|"
            r"armeabi-v7a|arm64-v8a)"
            r"([-_.].*)?\.(apk|aab|zip)$"
            r")"
        ),
    ),
    (
        "ios",
        re.compile(
            r"(?i)("
            r"\.ipa$|"
            r"[-_.](ios|iphone|ipad|apple-ios)"
            r"([-_.].*)?\.(ipa|zip)$"
            r")"
        ),
    ),
    (
        "windows",
        re.compile(r"(?i)\.(exe|msi|msix|msixbundle|appx)$"),
    ),
    (
        "macos",
        re.compile(
            r"(?i)("
            r"\.dmg$|\.pkg$|"
            r"[-_.](mac|macos|osx|darwin|apple-darwin|"
            r"darwin-amd64|darwin-arm64|darwin-universal|"
            r"macos-amd64|macos-arm64|macos-universal)"
            r"([-_.].*)?\.(zip|tar\.gz|tgz)$"
            r")"
        ),
    ),
    (
        "linux",
        re.compile(
            r"(?i)("
            r"\.AppImage$|\.deb$|\.rpm$|\.snap$|\.flatpak$|"
            r"[-_.](linux|ubuntu|debian|fedora|"
            r"linux-amd64|linux-x86_64|linux-arm64|linux-aarch64|"
            r"linux-armv7|linux-armhf|unknown-linux)"
            r"([-_.].*)?\.(AppImage|deb|rpm|snap|flatpak|tar\.gz|tgz|zip)$"
            r")"
        ),
    ),
]

_SKIP_ASSET = re.compile(
    r"(?i)("
    r"\.(pdb|dSYM|dSYMs)(\.|$)|[-_.](pdb|dsym|dbsym|symbols?)([-_.]|$)|"
    r"[-_.](source|src|sources)([-_.]|$)|(^|[-_.])(source|src|sources)(\.|$)|"
    r"\.tar\.gz$.*source|source.*\.tar\.gz$"
    r")"
)

_KNOWN = frozenset({"windows", "macos", "linux", "android", "ios"})


def detect_platforms_from_name(name: str) -> list[str]:
    """Return platform tags for an asset filename."""
    if _SKIP_ASSET.search(name):
        return []
    platforms: list[str] = []
    for label, pattern in _ASSET_RULES:
        if pattern.search(name):
            platforms.append(label)
    return platforms


def is_desktop_app_asset(name: str) -> bool:
    """True when the file looks like an installable app package."""
    return bool(detect_platforms_from_name(name))


def filter_desktop_assets(assets: Iterable[dict]) -> list[dict]:
    """Keep Win/Mac/Linux/Android/iOS application packages."""
    kept: list[dict] = []
    for asset in assets:
        name = asset.get("name") or ""
        platforms = detect_platforms_from_name(name)
        if not platforms:
            continue
        item = dict(asset)
        item["platforms"] = platforms
        item["platform"] = platforms[0]
        kept.append(item)
    return kept


def summarize_platforms(assets: Iterable[dict]) -> dict:
    platforms: set[str] = set()
    for asset in assets:
        for p in asset.get("platforms") or detect_platforms_from_name(
            asset.get("name") or ""
        ):
            if p in _KNOWN:
                platforms.add(p)
    return {
        "platforms": sorted(platforms),
        "has_windows": "windows" in platforms,
        "has_macos": "macos" in platforms,
        "has_linux": "linux" in platforms,
        "has_android": "android" in platforms,
        "has_ios": "ios" in platforms,
    }
