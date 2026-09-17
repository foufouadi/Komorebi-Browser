# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Generate a CycloneDX software bill of materials for the tree.

``generate()`` is shared by `mach sbom` and by the py_action the build's `sbom`
step runs, so the document a build uploads is the one the command produces.
"""

import argparse
import os
import sys


def generate(topsrcdir, repo, output=None, version=None, strict=False):
    """Write the SBOM to ``output``, or to stdout. Returns a process exit code."""
    from mozbuild.vendor.sbom import collect_records
    from mozbuild.vendor.sbom_cyclonedx import build_bom, to_json, utc_timestamp

    def log(message):
        print(message, file=sys.stderr)

    records, errors = collect_records(repo, topsrcdir, log=log)
    if errors and strict:
        log(f"{len(errors)} manifest(s) failed to load.")
        return 1

    if version is None:
        with open(
            os.path.join(topsrcdir, "browser", "config", "version_display.txt"),
            encoding="utf-8",
        ) as version_file:
            version = version_file.read().strip()

    # head_rev, not head_ref: the latter is a branch name under git, which
    # would make the BOM serial number move with the branch.
    source_revision = repo.head_rev

    # Default to the head commit time rather than the wall clock, so that two
    # runs over the same checkout produce byte-identical output.
    # SOURCE_DATE_EPOCH wins where release engineering sets it.
    source_date_epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if source_date_epoch:
        try:
            commit_time = int(source_date_epoch)
        except ValueError:
            log(
                "SOURCE_DATE_EPOCH must be an integer number of seconds since "
                f"the epoch, not {source_date_epoch!r}.",
            )
            return 1
    else:
        # A source tarball has no VCS, so no commit time to fall back on.
        commit_time = repo.get_commit_time() or 0
    timestamp = utc_timestamp(commit_time)

    unrecognized = []
    bom = build_bom(
        records, version, source_revision, timestamp, unrecognized=unrecognized
    )
    document = to_json(bom)

    if unrecognized:
        log(
            f"{len(unrecognized)} license value(s) are neither an SPDX id nor "
            "an expression and are recorded as free text: "
            f"{', '.join(sorted(set(unrecognized)))}."
        )

    if output:
        with open(output, "w", encoding="utf-8", newline="\n") as output_file:
            output_file.write(document)
        log(
            f"Wrote {len(records)} components to {output}.",
        )
    else:
        sys.stdout.write(document)

    return 0


def main(argv):
    import buildconfig
    from mozversioncontrol import get_repository_object

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="Write the SBOM here.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if any moz.yaml fails to load.",
    )
    args = parser.parse_args(argv)

    return generate(
        buildconfig.topsrcdir,
        get_repository_object(buildconfig.topsrcdir),
        output=args.output,
        strict=args.strict,
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
