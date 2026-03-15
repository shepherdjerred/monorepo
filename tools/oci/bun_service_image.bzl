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
        prisma_schema = None,
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
        prisma_schema: Path to prisma schema file (e.g., "prisma/schema.prisma").
            When set, runs ``prisma generate`` after ``bun install`` to produce
            the Prisma client in the deps layer.
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
            srcs = [ws_label, "//" + ws_dir + ":package.json"],
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
        prisma_schema = prisma_schema,
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

def _bun_install_layer(name, package_json, workspace_packages, pkg_dir, prisma_schema = None):
    """Run bun install and produce a tar of node_modules.

    Instead of using bun workspaces (which requires ALL workspace packages from
    the lockfile to be present), we install as a standalone package:
    1. Copy the service's package.json to a clean tmpdir root
    2. Replace workspace:* deps with * (resolve from registry)
    3. Run bun install without any lockfile or workspace config
    4. Package node_modules into a tar for the container image

    The bun.lock is kept in srcs for Bazel cache invalidation but not copied.
    """

    srcs = [
        package_json,
        "//:bun.lock",
    ]

    if prisma_schema:
        srcs.append(prisma_schema)

    # Workspace packages' package.json files are needed to extract their
    # production dependencies and merge them into the install.
    for ws_dir in workspace_packages.keys():
        srcs.append("//" + ws_dir + ":package.json")

    # Build shell code to merge workspace package deps into the main package.json.
    # For each workspace dep, read its package.json and merge its production deps.
    # After merging, remove any workspace:* protocol deps (inter-workspace deps
    # that only exist in the monorepo, not on npm).
    ws_merge = ""
    for ws_dir in workspace_packages.keys():
        ws_merge += """
            WS_PJ=$$EXECROOT/$(location //{ws_dir}:package.json) && \
            $$BUN -e "var f=require('fs'),main=JSON.parse(f.readFileSync('package.json','utf8')),ws=JSON.parse(f.readFileSync('$$WS_PJ','utf8'));var d=main.dependencies=main.dependencies||{{}};var wd=ws.dependencies||{{}};for(var k in wd)if(!wd[k].startsWith('workspace:'))d[k]=wd[k];f.writeFileSync('package.json',JSON.stringify(main,null,2))" && \
        """.format(ws_dir = ws_dir)

    # Build shell code to create node_modules symlinks for workspace packages.
    # After copying node_modules to TARDIR, create symlinks pointing to where
    # the ws source layers will be placed in the final image. These must be
    # created in TARDIR (not the install dir) since cp -rL would try to
    # dereference them and fail (targets don't exist at build time).
    # Note: pkg_tar doesn't fully strip the prefix from bun_library outputs,
    # so files end up at /workspace/{ws_dir}/{ws_dir}/src/... — the symlink
    # must point to the actual nested location.
    ws_symlinks = ""
    for ws_dir in workspace_packages.keys():
        # Read the package name from the workspace package's package.json
        ws_symlinks += """
            WS_PJ=$$EXECROOT/$(location //{ws_dir}:package.json) && \
            WS_NAME=$$($$BUN -e "console.log(require('$$WS_PJ').name)") && \
            rm -rf $$TARDIR/workspace/{pkg_dir}/node_modules/$$WS_NAME && \
            ln -sf /workspace/{ws_dir}/{ws_dir} $$TARDIR/workspace/{pkg_dir}/node_modules/$$WS_NAME && \
        """.format(ws_dir = ws_dir, pkg_dir = pkg_dir)

    native.genrule(
        name = name,
        srcs = srcs,
        outs = [name + ".tar"],
        cmd = """
            EXECROOT=$$PWD && \
            BUN=$$EXECROOT/$(location //tools/bun) && \
            OUTPUT_TAR=$$EXECROOT/$@ && \
            INSTALLDIR=$$(mktemp -d) && \
            trap 'rm -rf $$INSTALLDIR' EXIT && \
            cp $(location {package_json}) $$INSTALLDIR/package.json && \
            cd $$INSTALLDIR && \
            $$BUN -e 'var f=require("fs"),p=JSON.parse(f.readFileSync("package.json","utf8"));delete p.devDependencies;delete p.patchedDependencies;delete p.workspaces;var d=p.dependencies||{{}};for(var k in d)if(d[k].startsWith("workspace:"))delete d[k];f.writeFileSync("package.json",JSON.stringify(p,null,2))' && \
            {ws_merge} \
            export HOME=$$INSTALLDIR && \
            $$BUN install --ignore-scripts 1>&2 || {{ echo "ERROR: bun install failed (exit $$?) in $$(pwd)" >&2; echo "HOME=$$HOME" >&2; echo "ls -la:" >&2; ls -la >&2; echo "ls -la node_modules/ 2>/dev/null:" >&2; ls -la node_modules/ >&2 || true; echo "cat package.json:" >&2; cat package.json >&2; exit 1; }} && \
            test -d node_modules || {{ echo "ERROR: node_modules not created" >&2; ls -la >&2; exit 1; }} && \
            {prisma_generate} \
            TARDIR=$$(mktemp -d) && \
            mkdir -p $$TARDIR/workspace/{pkg_dir} && \
            cp -rL node_modules $$TARDIR/workspace/{pkg_dir}/node_modules && \
            {ws_symlinks} \
            (tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf $$OUTPUT_TAR -C $$TARDIR workspace 2>/dev/null || tar -cf $$OUTPUT_TAR -C $$TARDIR workspace) && \
            rm -rf $$TARDIR && \
            tar -tf $$OUTPUT_TAR | grep "node_modules/" > /dev/null 2>&1 || {{ echo "ERROR: empty node_modules in tar" >&2; tar -tf $$OUTPUT_TAR | head -20 >&2; exit 1; }}
        """.format(
            pkg_dir = pkg_dir,
            package_json = package_json,
            ws_merge = ws_merge if ws_merge else "true && ",
            ws_symlinks = ws_symlinks if ws_symlinks else "true &&",
            prisma_generate = (
                'mkdir -p $$(dirname {schema}) && cp $$EXECROOT/$(location {schema}) {schema} && ln -sf $$BUN $$(dirname $$BUN)/node && export DATABASE_URL=file:./dev.db && PATH=$$(dirname $$BUN):$$PATH && PRISMA_VER=$$($$BUN -e "console.log(require(\\\"./node_modules/@prisma/client/package.json\\\").version)") && $$BUN add prisma@$$PRISMA_VER 1>&2 && $$BUN node_modules/.bin/prisma generate --schema={schema} 1>&2 && '.format(
                    schema = prisma_schema,
                ) if prisma_schema else "true &&"
            ),
        ),
        tools = ["//tools/bun"],
        tags = ["manual", "requires-network"],
    )
