"""bun_prisma_brand rule — post-processes Prisma generated types with branded IDs.

Takes raw Prisma client output (from bun_prisma_generate) and runs a branding
script that replaces plain number/string types with branded types from
@scout-for-lol/data. Produces a new TreeArtifact with the branded types.

The script reads from BRAND_TYPES_INPUT_DIR (read-only) and writes to
BRAND_TYPES_OUTPUT_DIR (the declared output). No in-place modification.
"""

def _bun_prisma_brand_impl(ctx):
    bun = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"].bun_info.bun

    out = ctx.actions.declare_directory(ctx.label.name)
    raw_client = ctx.attr.prisma_client[DefaultInfo].files.to_list()[0]
    script = ctx.file.script
    nm = ctx.attr.node_modules[DefaultInfo].files.to_list()[0]

    # Copy script deps into a temp dir so #src/* imports resolve
    dep_copies = []
    for f in ctx.files.deps:
        dep_copies.append(
            'mkdir -p "$WORK/$(dirname "{sp}")" && cp "{p}" "$WORK/{sp}"'.format(
                p = f.path,
                sp = f.short_path,
            ),
        )

    ctx.actions.run_shell(
        outputs = [out],
        inputs = [raw_client, script, bun, nm] + ctx.files.deps,
        command = """\
set -euo pipefail
EXEC_ROOT="$PWD"

# Set up a minimal work dir for script deps and node_modules
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Copy script dependencies (e.g., src/logger.ts)
{dep_copies}

# Symlink node_modules (ts-morph, tslog, etc.)
ln -sfn "$EXEC_ROOT/{nm}" "$WORK/node_modules"

# Run the branding script first — it reads from the raw client (read-only)
# and writes only index.d.ts to the output directory.
cd "$WORK"
BRAND_TYPES_INPUT_DIR="$EXEC_ROOT/{raw_client}" \
BRAND_TYPES_OUTPUT_DIR="$EXEC_ROOT/{out}" \
    "$EXEC_ROOT/{bun}" "$EXEC_ROOT/{script}"

# Copy remaining files (js, other d.ts) from raw client, skipping index.d.ts
# which was already written by the branding script.
cd "$EXEC_ROOT"
for f in "{raw_client}"/*; do
    name=$(basename "$f")
    if [ "$name" != "index.d.ts" ]; then
        cp -R "$f" "{out}/$name"
    fi
done
""".format(
            raw_client = raw_client.path,
            script = script.path,
            bun = bun.path,
            nm = nm.path,
            out = out.path,
            dep_copies = "\n".join(dep_copies),
        ),
        mnemonic = "BunPrismaBrand",
        progress_message = "Branding Prisma types for %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([out]))]

bun_prisma_brand = rule(
    implementation = _bun_prisma_brand_impl,
    attrs = {
        "prisma_client": attr.label(
            mandatory = True,
            doc = "Label of bun_prisma_generate target producing raw Prisma client.",
        ),
        "script": attr.label(
            mandatory = True,
            allow_single_file = True,
            doc = "The branding script (e.g., brand-prisma-types.ts).",
        ),
        "deps": attr.label_list(
            allow_files = True,
            doc = "Source files needed by the branding script.",
        ),
        "node_modules": attr.label(
            mandatory = True,
            allow_single_file = True,
            doc = "node_modules with ts-morph and other script dependencies.",
        ),
    },
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
