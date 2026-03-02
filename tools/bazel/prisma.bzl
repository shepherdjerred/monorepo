"""Prisma generate macro for packages that use Prisma ORM.

Creates a genrule that runs `prisma generate` to produce the
Prisma client from a schema file, using the toolchain Bun binary.
"""

def prisma_generate(name, schema, deps = []):
    """Generate Prisma client in sandbox.

    Produces a tree artifact containing the generated Prisma client.

    Args:
        name: Target name
        schema: Label for the prisma schema file (e.g., "prisma/schema.prisma")
        deps: Additional dependencies (e.g., package.json)
    """
    native.genrule(
        name = name,
        srcs = [schema, "package.json"] + deps,
        outs = [name + "_out"],
        cmd = "$(location //tools/bun) x prisma generate --schema=$(location %s) && touch $@" % schema,
        tools = ["//tools/bun"],
        tags = ["manual", "requires-network"],
    )
