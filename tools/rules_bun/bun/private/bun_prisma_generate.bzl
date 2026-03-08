"""bun_prisma_generate rule implementation."""

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
            WORK=$(mktemp -d)
            mkdir -p "$WORK/prisma"
            cp {schema} "$WORK/prisma/schema.prisma"
            echo '{{"name":"prisma-gen-tmp"}}' > "$WORK/package.json"

            (cd "$WORK" && HOME="$WORK" "$OLDPWD/$BUN" add "@prisma/client@{version}" 2>/dev/null) || true
            (cd "$WORK" && HOME="$WORK" PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
                "$OLDPWD/$BUN" x --bun "prisma@{version}" generate \
                    --schema=prisma/schema.prisma --no-engine --no-hints 2>/dev/null) || true

            GENERATED=$(find "$WORK" -path '*/.prisma/client' -type d 2>/dev/null | head -1)
            if [ -n "$GENERATED" ] && [ -d "$GENERATED" ]; then
                cp -R "$GENERATED"/* {out}/
            else
                echo "ERROR: prisma generate did not produce .prisma/client" >&2
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
        "version": attr.string(default = "6.19.2"),
    },
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
