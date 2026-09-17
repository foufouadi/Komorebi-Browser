# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""`mach sbom`, the machine-readable view of the third-party code we ship.

It runs in the `build` site, where cyclonedx lives, because the build generates
the document too: the command and the `generate_sbom` py_action the build's
`sbom` step runs share one implementation.
"""

from mach.decorators import Command, CommandArgument


@Command(
    "sbom",
    category="build",
    virtualenv_name="build",
    description="Generate a CycloneDX software bill of materials for the tree.",
)
@CommandArgument(
    "-o",
    "--output",
    default=None,
    help="Write the SBOM here instead of stdout.",
)
@CommandArgument(
    "--version",
    default=None,
    help="Version to record for the product itself. Defaults to "
    "browser/config/version_display.txt.",
)
@CommandArgument(
    "--strict",
    action="store_true",
    default=False,
    help="Exit non-zero if any moz.yaml fails to load.",
)
def sbom(command_context, output, version, strict):
    from mozbuild.action.generate_sbom import generate

    command_context.populate_logger()
    command_context.log_manager.enable_unstructured()

    return generate(
        command_context.topsrcdir,
        command_context.repository,
        output=output,
        version=version,
        strict=strict,
    )
