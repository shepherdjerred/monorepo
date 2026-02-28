"""Reusable macros for building OCI images of Bun-based services.

Creates a container image by:
1. Running `bun install` in a sandboxed action to produce node_modules
2. Packaging source files and node_modules into tar layers
3. Stacking layers onto a Bun base image with oci_image
"""

load("@aspect_bazel_lib//lib:expand_template.bzl", "expand_template")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

def bun_service_image(
        name,
        srcs,
        package_json,
        base = "@bun_debian",
        workspace_packages = None,
        entry_point = "src/index.ts",
        workdir = None,
        env = None,
        exposed_ports = None,
        labels = None,
        repository = None,
        visibility = None):
    """Build an OCI image for a Bun-based service.

    This creates several targets:
      - {name}_deps_layer: tar layer with node_modules (from bun install)
      - {name}_src_layer: tar layer with application source files
      - {name}: the oci_image combining base + layers
      - {name}_push: oci_push target (if repository is set)

    Args:
        name: Target name for the image.
        srcs: Source files to include (typically glob(["src/**/*.ts"]) + ["package.json"]).
        package_json: Label to the service's package.json.
        base: Base OCI image (default: @bun_debian).
        workspace_packages: Dict of {package_dir: label} for workspace dependencies.
            E.g., {"packages/tasknotes-types": "//packages/tasknotes-types:pkg"}
        entry_point: Entry point file relative to the package (default: src/index.ts).
        workdir: Container working directory. Defaults to /workspace/{package_path}.
        env: Dict of environment variables.
        exposed_ports: List of exposed ports (e.g., ["3000"]).
        labels: Dict of OCI image labels.
        repository: GHCR repository for oci_push (e.g., "ghcr.io/shepherdjerred/tasknotes-server").
        visibility: Bazel visibility.
    """

    if workspace_packages == None:
        workspace_packages = {}

    pkg_dir = native.package_name()

    if workdir == None:
        workdir = "/workspace/" + pkg_dir

    # Source layer: application code packaged into the container
    pkg_tar(
        name = name + "_src_layer",
        srcs = srcs,
        strip_prefix = ".",
        package_dir = "/workspace/" + pkg_dir,
    )

    # Workspace dependency source layers
    ws_tar_names = []
    for ws_dir, ws_label in workspace_packages.items():
        tar_name = name + "_ws_" + ws_dir.replace("/", "_")
        pkg_tar(
            name = tar_name,
            srcs = [ws_label],
            strip_prefix = ws_dir,
            package_dir = "/workspace/" + ws_dir,
        )
        ws_tar_names.append(":" + tar_name)

    # Dependencies layer: run bun install and package node_modules
    _bun_install_layer(
        name = name + "_deps_layer",
        package_json = package_json,
        workspace_packages = workspace_packages,
        pkg_dir = pkg_dir,
    )

    # Combine all tar layers (deps first = less frequently changed = better caching)
    all_tars = [
        ":" + name + "_deps_layer",
    ] + ws_tar_names + [
        ":" + name + "_src_layer",
    ]

    # Build the OCI image
    _kwargs = {}
    if env:
        _kwargs["env"] = env
    if exposed_ports:
        _kwargs["exposed_ports"] = exposed_ports
    if labels:
        _kwargs["labels"] = labels

    oci_image(
        name = name,
        base = base,
        tars = all_tars,
        entrypoint = ["bun", "run", entry_point],
        workdir = workdir,
        visibility = visibility,
        **_kwargs
    )

    # Push target with stamped git SHA tag
    if repository:
        # Create a tags file with the git SHA from workspace status stamping.
        # The template uses stamp_substitutions so the SHA is resolved at
        # build time from the workspace_status_command output.
        native.genrule(
            name = name + "_tags_tmpl",
            outs = [name + "_tags_tmpl.txt"],
            cmd = "echo '{STABLE_GIT_SHA}' > $@",
        )

        expand_template(
            name = name + "_tags",
            out = name + "_tags.txt",
            template = ":" + name + "_tags_tmpl",
            stamp_substitutions = {"{STABLE_GIT_SHA}": "{{STABLE_GIT_SHA}}"},
        )

        oci_push(
            name = name + "_push",
            image = ":" + name,
            repository = repository,
            remote_tags = ":" + name + "_tags",
            visibility = visibility,
        )

def _bun_install_layer(name, package_json, workspace_packages, pkg_dir):
    """Run bun install and produce a tar of node_modules."""

    srcs = [
        package_json,
        "//:package.json",
        "//:bun.lock",
    ]

    for ws_dir in workspace_packages.keys():
        srcs.append("//" + ws_dir + ":package.json")

    ws_copies = ""
    for ws_dir in workspace_packages.keys():
        ws_copies += "mkdir -p $$TMPDIR/{ws_dir} && cp $(location //{ws_dir}:package.json) $$TMPDIR/{ws_dir}/package.json && ".format(ws_dir = ws_dir)

    native.genrule(
        name = name,
        srcs = srcs,
        outs = [name + ".tar"],
        cmd = """\\\r
            EXECROOT=$$PWD && \\\r
            OUTPUT_TAR=$$EXECROOT/$@ && \\\r
            TMPDIR=$$(mktemp -d) && \\\r
            trap 'rm -rf $$TMPDIR' EXIT && \\\r
            cp $(location //:package.json) $$TMPDIR/package.json && \\\r
            cp $(location //:bun.lock) $$TMPDIR/bun.lock && \\\r
            mkdir -p $$TMPDIR/{pkg_dir} && \\\r
            cp $(location {package_json}) $$TMPDIR/{pkg_dir}/package.json && \\\r
            {ws_copies} \\\r
            cd $$TMPDIR && \\\r
            bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null || true && \\\r
            tar -cf $$OUTPUT_TAR \\\r
                -C $$TMPDIR \\\r
                --transform 's,^,workspace/,' \\\r
                {pkg_dir}/node_modules \\\r
                node_modules \\\r
                2>/dev/null || \\\r
            tar -cf $$OUTPUT_TAR --files-from=/dev/null \\\r
        """.format(
            pkg_dir = pkg_dir,
            package_json = package_json,
            ws_copies = ws_copies if ws_copies else "true && ",
        ),
        tags = ["requires-network"],
    )
