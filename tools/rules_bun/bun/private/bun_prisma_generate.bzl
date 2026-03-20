"""bun_prisma_generate rule implementation."""

load(":prisma_versions.bzl", "PRISMA_DEFAULT_VERSION")

def _bun_prisma_generate_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun

    out = ctx.actions.declare_directory(ctx.label.name + "_client")
    schema = ctx.file.schema
    version = ctx.attr.version

    ctx.actions.run_shell(
        outputs = [out],
        inputs = [schema, bun],
        command = """
            set -euo pipefail
            BUN="{bun}"
            # Create a node symlink so postinstall scripts and prisma CLI
            # can find "node" (bun is Node-compatible).
            # Prisma hangs without a "node" binary: https://github.com/prisma/prisma/issues/26560
            BINDIR=$(mktemp -d)
            ln -s "$PWD/$BUN" "$BINDIR/node"
            ln -s "$PWD/$BUN" "$BINDIR/bun"
            export PATH="$BINDIR:$PATH"
            WORK=$(mktemp -d)
            mkdir -p "$WORK/prisma"
            cp {schema} "$WORK/prisma/schema.prisma"
            echo '{{"name":"prisma-gen-tmp"}}' > "$WORK/package.json"

            (cd "$WORK" && HOME="$WORK" "$OLDPWD/$BUN" add --ignore-scripts "@prisma/client@{version}" "prisma@{version}")
            (cd "$WORK" && HOME="$WORK" PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
                "$OLDPWD/$BUN" node_modules/.bin/prisma generate \
                    --schema=prisma/schema.prisma --no-engine --no-hints)

            # Find generated client — standard path (.prisma/client) or custom output
            GENERATED=$(find "$WORK" -path '*/.prisma/client' -type d 2>/dev/null | head -1)
            if [ -z "$GENERATED" ]; then
                # Custom output: look for index.d.ts under any */client/ dir
                IDX=$(find "$WORK" -path '*/client/index.d.ts' -type f 2>/dev/null | head -1)
                if [ -n "$IDX" ]; then
                    GENERATED=$(dirname "$IDX")
                fi
            fi
            if [ -n "$GENERATED" ] && [ -d "$GENERATED" ]; then
                cp -R "$GENERATED"/* {out}/
            else
                echo "ERROR: prisma generate did not produce client output" >&2
                exit 1
            fi
            rm -rf "$WORK"
        """.format(schema = schema.path, bun = bun.path, out = out.path, version = version),
        execution_requirements = {"requires-network": ""},
        mnemonic = "BunPrismaGenerate",
        progress_message = "Generating Prisma client from %s" % ctx.file.schema.short_path,
    )

    return [DefaultInfo(files = depset([out]))]

bun_prisma_generate = rule(
    implementation = _bun_prisma_generate_impl,
    attrs = {
        "schema": attr.label(mandatory = True, allow_single_file = [".prisma"]),
        "version": attr.string(default = PRISMA_DEFAULT_VERSION),
    },
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
