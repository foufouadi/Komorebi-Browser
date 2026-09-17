# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Map in-tree moz.yaml manifests onto ecosystem-neutral SBOM records.

This module deliberately does not import cyclonedx, so the mapping rules can be
unit tested from sites that do not vendor it. See sbom_cyclonedx.py for the
serialization half.
"""

import re

import mozpack.path as mozpath

from mozbuild.vendor.moz_yaml import MozYamlVerifyError, load_moz_yaml

# `origin.release` is free-form prose, not a version. Real values look like
# "v1.6.58 (2026-04-15T20:23:26+03:00)." or "version 3.7.3".
RE_RELEASE_PREFIX = re.compile(r"^(?:version|tag|release)\s+", re.IGNORECASE)
RE_RELEASE_SUFFIX = re.compile(r"\s*\([^)]*\)\s*\.?\s*$")

RE_GITHUB = re.compile(
    r"^https?://(?:www\.)?github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$", re.IGNORECASE
)
# Only gitlab.com: pkg:gitlab has no notion of a host, so claiming it for a
# self-hosted instance would point at the wrong project. Every gitlab-hosted
# dependency in-tree today is self-hosted (freedesktop, xiph, videolan) and
# correctly falls through to pkg:generic with a vcs_url qualifier.
RE_GITLAB = re.compile(
    r"^https?://(?:www\.)?gitlab\.com/(.+?)/([^/]+?)(?:\.git)?/?$", re.IGNORECASE
)

RE_PURL_UNSAFE = re.compile(r"[^a-z0-9._-]+")

# `mach vendor`'s updatebot-only shims describe a version bump rather than code
# vendored at this path, so they are not components.
PSEUDO_SOURCE_HOSTING = "yaml-dir"


def clean_version(release):
    """Reduce a free-form `origin.release` to something version-shaped."""
    if not release:
        return None
    version = RE_RELEASE_SUFFIX.sub("", release.strip())
    version = RE_RELEASE_PREFIX.sub("", version).strip()
    return version.rstrip(".") or None


def purl_slug(name):
    return RE_PURL_UNSAFE.sub("-", name.strip().lower()).strip("-") or "unknown"


def _purl(name, version, vendoring):
    """Derive a package URL, preferring a type that vulnerability databases index.

    pkg:generic matches nothing in OSV.dev or the GitHub Advisory Database, so
    github/gitlab URLs are recognised explicitly and everything else keeps the
    upstream repository in a vcs_url qualifier.
    """
    url = (vendoring or {}).get("url", "")
    hosting = (vendoring or {}).get("source-hosting")

    if hosting == "github":
        match = RE_GITHUB.match(url)
        if match:
            namespace, repo = match.group(1).lower(), match.group(2).lower()
            return ("github", namespace, repo, version, {})
    elif hosting == "gitlab":
        match = RE_GITLAB.match(url)
        if match:
            namespace, repo = match.group(1).lower(), match.group(2).lower()
            return ("gitlab", namespace, repo, version, {})

    qualifiers = {}
    if url:
        qualifiers["vcs_url"] = f"git+{url}" + (f"@{version}" if version else "")
    return ("generic", None, purl_slug(name), version, qualifiers)


def _licenses(origin):
    """Normalize `origin.license` to a list of strings.

    yaml.BaseLoader gives us strings for scalars, but the field is also allowed
    to be a list -- moz_yaml.py:274 makes the same distinction.
    """
    license = origin.get("license")
    if not license:
        return []
    if isinstance(license, str):
        return [license]
    return list(license)


def manifest_to_record(rel_path, manifest):
    """Build an SBOM record from one parsed moz.yaml.

    `rel_path` is the topsrcdir-relative path of the manifest itself. Returns
    None for manifests that do not describe a vendored component.
    """
    origin = manifest.get("origin")
    if not origin:
        return None

    vendoring = manifest.get("vendoring") or {}
    if vendoring.get("source-hosting") == PSEUDO_SOURCE_HOSTING:
        return None

    manifest_dir = mozpath.dirname(rel_path) or "."
    name = origin["name"]
    version = origin.get("revision") or clean_version(origin.get("release"))

    properties = {
        "moz:moz-yaml.path": rel_path,
        "moz:bugzilla.product": manifest["bugzilla"]["product"],
        "moz:bugzilla.component": manifest["bugzilla"]["component"],
    }
    for key, value in (
        ("moz:origin.release", origin.get("release")),
        ("moz:origin.notes", origin.get("notes")),
        ("moz:vendoring.source-hosting", vendoring.get("source-hosting")),
        ("moz:vendoring.vendor-directory", vendoring.get("vendor-directory")),
    ):
        if value:
            properties[key] = value

    licenses = _licenses(origin)
    if len(licenses) > 1:
        # moz.yaml has no AND/OR operator, and the answer genuinely differs per
        # library (libjpeg-turbo's IJG/BSD-3-Clause is AND; MIT/Apache-2.0 is
        # usually OR). Record the ambiguity rather than inventing a legal fact.
        properties["moz:license.conjunction"] = "unspecified"

    return {
        "bom_ref": manifest_dir,
        "name": name,
        "version": version,
        "description": origin.get("description"),
        "purl": _purl(name, version, vendoring),
        "licenses": licenses,
        "website": origin.get("url"),
        "vcs": vendoring.get("url"),
        "bugzilla": (
            manifest["bugzilla"]["product"],
            manifest["bugzilla"]["component"],
        ),
        "properties": properties,
    }


def discover_manifests(repo, topsrcdir):
    """Yield topsrcdir-relative paths of every tracked moz.yaml, sorted.

    Driving this off version control rather than a filesystem walk keeps
    objdirs, node_modules and untracked scratch files out of the result.
    """
    finder = repo.get_tracked_files_finder(topsrcdir)
    paths = [
        path
        for path, _ in finder.find("**/moz.yaml")
        if mozpath.basename(path) == "moz.yaml"
    ]
    return sorted(paths)


def collect_records(repo, topsrcdir, log=None):
    """Load every tracked moz.yaml and map it. Returns (records, errors)."""
    records = []
    errors = []
    for rel_path in discover_manifests(repo, topsrcdir):
        full_path = mozpath.join(topsrcdir, rel_path)
        try:
            manifest = load_moz_yaml(full_path, require_license_file=False)
        except (MozYamlVerifyError, ValueError) as error:
            errors.append((rel_path, str(error)))
            if log:
                log(f"skipping {rel_path}: {error}")
            continue
        record = manifest_to_record(rel_path, manifest)
        if record:
            records.append(record)
    records.sort(key=lambda record: record["bom_ref"])
    return records, errors
