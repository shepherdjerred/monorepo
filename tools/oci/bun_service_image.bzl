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
        tags = ["manual"],
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
            tags = ["manual"],
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

    # Default OCI labels — image.source enables auto-linking on GHCR
    default_labels = {"org.opencontainers.image.source": "https://github.com/shepherdjerred/monorepo"}
    if labels:
        default_labels.update(labels)
    _kwargs["labels"] = default_labels

    oci_image(
        name = name,
        base = base,
        tars = all_tars,
        entrypoint = ["/usr/local/bin/bun", "run", entry_point],
        workdir = workdir,
        tags = ["manual"],
        visibility = visibility,
        **_kwargs
    )

    # Push target with stamped git SHA tag
    if repository:
        expand_template(
            name = name + "_tags",
            out = name + "_tags.txt",
            template = "//tools/oci:git_sha_tag.tmpl",
            stamp_substitutions = {"{STABLE_GIT_SHA}": "{{STABLE_GIT_SHA}}"},
            tags = ["manual"],
        )

        oci_push(
            name = name + "_push",
            image = ":" + name,
            repository = repository,
            remote_tags = ":" + name + "_tags",
            tags = ["manual"],
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

    # Build a comma-separated list of workspace dirs for the root package.json.
    # This prevents bun install from failing on missing workspace directories.
    workspace_dirs = [pkg_dir] + list(workspace_packages.keys())
    workspace_csv = ",".join(workspace_dirs)

    native.genrule(
        name = name,
        srcs = srcs,
        outs = [name + ".tar"],
        cmd = """
            EXECROOT=$$PWD && \
            BUN=$$EXECROOT/$(location //tools/bun) && \
            OUTPUT_TAR=$$EXECROOT/$@ && \
            TMPDIR=$$(mktemp -d) && \
            trap 'rm -rf $$TMPDIR' EXIT && \
            cp $(location //:package.json) $$TMPDIR/package.json && \
            cp $(location //:bun.lock) $$TMPDIR/bun.lock && \
            mkdir -p $$TMPDIR/{pkg_dir} && \
            cp $(location {package_json}) $$TMPDIR/{pkg_dir}/package.json && \
            {ws_copies} \
            cd $$TMPDIR && \
            $$BUN -e 'var f=require("fs"),p=JSON.parse(f.readFileSync("package.json","utf8"));p.workspaces="{workspace_csv}".split(",");delete p.patchedDependencies;delete p.devDependencies;f.writeFileSync("package.json",JSON.stringify(p,null,2))' && \
            for pj in {pkg_dir}/package.json {ws_package_jsons}; do \
                $$BUN -e "var f=require('fs'),p=JSON.parse(f.readFileSync('$$pj','utf8'));delete p.patchedDependencies;delete p.devDependencies;f.writeFileSync('$$pj',JSON.stringify(p,null,2))" ; \
            done && \
            rm -f bun.lock && \
            $$BUN install --ignore-scripts --production && \
            echo "DEBUG: cwd=$$PWD" >&2 && \
            echo "DEBUG: root node_modules:" >&2 && (ls -la node_modules/ 2>&1 | head -20) >&2 && \
            echo "DEBUG: pkg node_modules:" >&2 && (ls -la {pkg_dir}/node_modules/ 2>&1 | head -10) >&2 && \
            echo "DEBUG: node_modules type:" >&2 && (file node_modules 2>&1) >&2 && \
            echo "DEBUG: root nm file count:" >&2 && (find node_modules -type f 2>/dev/null | wc -l) >&2 && \
            echo "DEBUG: pkg nm file count:" >&2 && (find {pkg_dir}/node_modules -type f 2>/dev/null | wc -l) >&2 && \
            TARDIR=$$(mktemp -d) && \
            mkdir -p $$TARDIR/workspace && \
            cp -rL node_modules $$TARDIR/workspace/node_modules 2>&1 && \
            if [ -d {pkg_dir}/node_modules ]; then \
                mkdir -p $$TARDIR/workspace/{pkg_dir} && \
                cp -rL {pkg_dir}/node_modules $$TARDIR/workspace/{pkg_dir}/node_modules 2>&1; \
            fi && \
            echo "DEBUG: tardir contents:" >&2 && (find $$TARDIR -maxdepth 4 -type d 2>&1 | head -20) >&2 && \
            (tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf $$OUTPUT_TAR -C $$TARDIR workspace 2>/dev/null || tar -cf $$OUTPUT_TAR -C $$TARDIR workspace) && \
            rm -rf $$TARDIR && \
            echo "DEBUG: tar entry count:" >&2 && (tar -tf $$OUTPUT_TAR | wc -l) >&2 && \
            tar -tf $$OUTPUT_TAR | grep -q "node_modules/" || {{ echo "ERROR: empty node_modules" >&2; exit 1; }}
        """.format(
            pkg_dir = pkg_dir,
            package_json = package_json,
            ws_copies = ws_copies if ws_copies else "true && ",
            workspace_csv = workspace_csv,
            ws_package_jsons = " ".join([d + "/package.json" for d in workspace_packages.keys()]),
        ),
        tools = ["//tools/bun"],
        tags = ["manual", "requires-network"],
    )
