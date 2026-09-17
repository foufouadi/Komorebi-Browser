# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import unittest

from mozunit import main

from mozbuild.vendor.sbom import clean_version, manifest_to_record, purl_slug


def manifest(origin=None, vendoring=None):
    result = {
        "schema": "1",
        "bugzilla": {"product": "Core", "component": "General"},
        "origin": {
            "name": "example",
            "description": "an example",
            "url": "https://example.com/",
            "license": "MIT",
            "release": "v1.0 (2026-01-01T00:00:00Z).",
            **(origin or {}),
        },
    }
    if vendoring is not None:
        result["vendoring"] = vendoring
    return result


class TestCleanVersion(unittest.TestCase):
    def test_clean_version(self):
        # `origin.release` is prose, not a version.
        vectors = [
            ("v1.6.58 (2026-04-15T20:23:26+03:00).", "v1.6.58"),
            ("VER-2-14-2 (2026-03-01T14:55:17+01:00).", "VER-2-14-2"),
            ("version 3.7.3", "3.7.3"),
            ("version 4.2", "4.2"),
            ("puppeteer-v24.35.0", "puppeteer-v24.35.0"),
            ("", None),
            (None, None),
        ]
        for release, expected in vectors:
            self.assertEqual(clean_version(release), expected, release)


class TestPurlSlug(unittest.TestCase):
    def test_purl_slug(self):
        vectors = [
            ("bsdiff/bspatch", "bsdiff-bspatch"),
            ("Chromium sandbox", "chromium-sandbox"),
            ("xz embedded", "xz-embedded"),
            ("Content Analysis SDK", "content-analysis-sdk"),
            ("zstd", "zstd"),
        ]
        for name, expected in vectors:
            self.assertEqual(purl_slug(name), expected, name)


class TestManifestToRecord(unittest.TestCase):
    def test_revision_preferred_over_release(self):
        record = manifest_to_record(
            "third_party/zstd/moz.yaml", manifest({"revision": "v1.5.7"})
        )
        self.assertEqual(record["version"], "v1.5.7")

    def test_release_used_when_no_revision(self):
        record = manifest_to_record(
            "a/moz.yaml", manifest({"release": "version 3.7.3"})
        )
        self.assertEqual(record["version"], "3.7.3")

    def test_bom_ref_is_manifest_directory(self):
        record = manifest_to_record("third_party/zstd/moz.yaml", manifest())
        self.assertEqual(record["bom_ref"], "third_party/zstd")

    def test_license_string_and_list(self):
        record = manifest_to_record("a/moz.yaml", manifest({"license": "MIT"}))
        self.assertEqual(record["licenses"], ["MIT"])
        self.assertNotIn("moz:license.conjunction", record["properties"])

        record = manifest_to_record(
            "a/moz.yaml", manifest({"license": ["IJG", "BSD-3-Clause"]})
        )
        self.assertEqual(record["licenses"], ["IJG", "BSD-3-Clause"])
        # moz.yaml has no AND/OR operator, so the ambiguity must be recorded
        # rather than resolved.
        self.assertEqual(record["properties"]["moz:license.conjunction"], "unspecified")

    def test_github_purl(self):
        record = manifest_to_record(
            "third_party/zstd/moz.yaml",
            manifest(
                {"revision": "v1.5.7"},
                {"url": "https://github.com/facebook/zstd", "source-hosting": "github"},
            ),
        )
        self.assertEqual(record["purl"], ("github", "facebook", "zstd", "v1.5.7", {}))

    def test_github_purl_strips_dot_git_and_lowercases(self):
        record = manifest_to_record(
            "a/moz.yaml",
            manifest(
                {"revision": "abc"},
                {
                    "url": "https://github.com/Microsoft/WebAuthn.git",
                    "source-hosting": "github",
                },
            ),
        )
        self.assertEqual(record["purl"], ("github", "microsoft", "webauthn", "abc", {}))

    def test_self_hosted_gitlab_falls_back_to_generic(self):
        # pkg:gitlab implies gitlab.com; claiming it for a self-hosted instance
        # would point at an unrelated project.
        record = manifest_to_record(
            "a/moz.yaml",
            manifest(
                {"name": "mesa", "revision": "abc"},
                {
                    "url": "https://gitlab.freedesktop.org/mesa/mesa",
                    "source-hosting": "gitlab",
                },
            ),
        )
        purl_type, namespace, name, version, qualifiers = record["purl"]
        self.assertEqual(
            (purl_type, namespace, name, version), ("generic", None, "mesa", "abc")
        )
        self.assertEqual(
            qualifiers["vcs_url"], "git+https://gitlab.freedesktop.org/mesa/mesa@abc"
        )

    def test_gitlab_dot_com_purl(self):
        record = manifest_to_record(
            "a/moz.yaml",
            manifest(
                {"revision": "abc"},
                {
                    "url": "https://gitlab.com/group/sub/proj",
                    "source-hosting": "gitlab",
                },
            ),
        )
        self.assertEqual(record["purl"], ("gitlab", "group/sub", "proj", "abc", {}))

    def test_no_vendoring_block_yields_generic_purl(self):
        record = manifest_to_record(
            "a/moz.yaml", manifest({"name": "fathom", "release": "version 3.7.3"})
        )
        self.assertEqual(record["purl"], ("generic", None, "fathom", "3.7.3", {}))

    def test_purl_hostile_name(self):
        record = manifest_to_record(
            "a/moz.yaml", manifest({"name": "bsdiff/bspatch", "release": "version 4.2"})
        )
        self.assertEqual(record["purl"][2], "bsdiff-bspatch")

    def test_yaml_dir_pseudo_manifest_skipped(self):
        record = manifest_to_record(
            "a/moz.yaml",
            manifest(vendoring={"url": "https://x/", "source-hosting": "yaml-dir"}),
        )
        self.assertIsNone(record)

    def test_properties(self):
        record = manifest_to_record(
            "third_party/zstd/moz.yaml",
            manifest(
                {"revision": "v1.5.7"},
                {
                    "url": "https://github.com/facebook/zstd",
                    "source-hosting": "github",
                    "vendor-directory": "third_party/zstd/lib",
                },
            ),
        )
        self.assertEqual(
            record["properties"]["moz:moz-yaml.path"], "third_party/zstd/moz.yaml"
        )
        self.assertEqual(record["properties"]["moz:bugzilla.product"], "Core")
        self.assertEqual(
            record["properties"]["moz:vendoring.vendor-directory"],
            "third_party/zstd/lib",
        )
        # The upstream tag is often more useful than the revision SHA, so the
        # verbatim release string is preserved.
        self.assertEqual(
            record["properties"]["moz:origin.release"], "v1.0 (2026-01-01T00:00:00Z)."
        )


if __name__ == "__main__":
    main()
