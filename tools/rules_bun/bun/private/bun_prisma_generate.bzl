"""bun_prisma_generate rule implementation."""

load(":prisma_versions.bzl", "PRISMA_DEFAULT_VERSION")

def _bun_prisma_generate_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun

    out = ctx.actions.declare_directory(ctx.label.name + "_client")
    schema = ctx.file.schema
    version = ctx.attr.version

    all_inputs = [schema, bun]
    post_gen_cmd = ""

    if ctx.file.post_generate_script:
        all_inputs.append(ctx.file.post_generate_script)
        all_inputs.extend(ctx.files.post_generate_deps)

        copy_deps = "\n            ".join([
            'mkdir -p "$WORK/$(dirname "{rel}")" && cp "$ROOT_DIR/{path}" "$WORK/{rel}"'.format(
                path = f.path,
                rel = f.short_path,
            )
            for f in ctx.files.post_generate_deps
        ])

        post_gen_cmd = """
            # --- Post-generate script (e.g., brand-prisma-types) ---
            # Copy post-generate deps into $WORK
            {copy_deps}

            # Ensure generated client is at $WORK/generated/prisma/client/
            # (the script expects this layout). If prisma used a custom output
            # path, the files may already be there; otherwise copy them.
            POST_CLIENT="$WORK/generated/prisma/client"
            if [ "$GENERATED" != "$POST_CLIENT" ]; then
                mkdir -p "$POST_CLIENT"
                cp -R "$GENERATED"/* "$POST_CLIENT/"
            fi

            # tsconfig for #src/* and #generated/* path aliases
            echo '{{"compilerOptions":{{"paths":{{"#src/*":["./src/*"],"#generated/*":["./generated/*"]}}}}}}' > "$WORK/tsconfig.json"

            # Install ts-morph (needed by the branding script)
            (cd "$WORK" && HOME="$WORK" "$ROOT_DIR/$BUN" add --ignore-scripts ts-morph 2>/dev/null)

            # Run the script. BRAND_TYPES_BASE_DIR overrides import.meta.dir
            # so it reads/writes in $WORK instead of the source tree.
            (cd "$WORK" && BRAND_TYPES_BASE_DIR="$WORK/scripts" "$ROOT_DIR/$BUN" "$ROOT_DIR/{script}") \
                || {{ echo "ERROR: post-generate script failed" >&2; exit 1; }}

            # Point GENERATED to the (now branded) output
            GENERATED="$POST_CLIENT"
        """.format(
            script = ctx.file.post_generate_script.path,
            copy_deps = copy_deps,
        )

    ctx.actions.run_shell(
        outputs = [out],
        inputs = all_inputs,
        command = """
            set -euo pipefail
            ROOT_DIR="$PWD"
            BUN="{bun}"
            BINDIR=$(mktemp -d)
            ln -s "$PWD/$BUN" "$BINDIR/node"
            ln -s "$PWD/$BUN" "$BINDIR/bun"
            export PATH="$BINDIR:$PATH"

            WORK=$(mktemp -d)
            mkdir -p "$WORK/prisma"
            cp {schema} "$WORK/prisma/schema.prisma"
            echo '{{"name":"prisma-gen-tmp"}}' > "$WORK/package.json"

            (cd "$WORK" && HOME="$WORK" "$ROOT_DIR/$BUN" add --ignore-scripts "@prisma/client@{version}" "prisma@{version}")
            (cd "$WORK" && HOME="$WORK" PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
                "$ROOT_DIR/$BUN" node_modules/.bin/prisma generate \
                    --schema=prisma/schema.prisma --no-hints)

            # Find the generated client directory
            GENERATED=$(find "$WORK" -path '*/.prisma/client' -type d 2>/dev/null | head -1)
            if [ -z "$GENERATED" ]; then
                IDX=$(find "$WORK" -path '*/client/index.d.ts' -not -path '*/node_modules/*' -type f 2>/dev/null | head -1)
                if [ -n "$IDX" ]; then
                    GENERATED=$(dirname "$IDX")
                fi
            fi
            if [ -z "$GENERATED" ] || [ ! -d "$GENERATED" ]; then
                echo "ERROR: prisma generate did not produce client output" >&2
                exit 1
            fi

            {post_gen_cmd}

            # Copy final output to the TreeArtifact
            cp -R "$GENERATED"/* {out}/
            rm -rf "$WORK"
        """.format(
            schema = schema.path,
            bun = bun.path,
            out = out.path,
            version = version,
            post_gen_cmd = post_gen_cmd,
        ),
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
        "post_generate_script": attr.label(
            allow_single_file = True,
            doc = "Script to run after prisma generate (e.g., brand-prisma-types.ts).",
        ),
        "post_generate_deps": attr.label_list(
            allow_files = True,
            doc = "Source files needed by the post-generate script.",
        ),
    },
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
