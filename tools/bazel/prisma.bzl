"""Prisma generate macro for packages that use Prisma ORM.

Creates a genrule that runs `bunx prisma generate` to produce the
Prisma client from a schema file.
"""

def prisma_generate(name, schema, deps = []):
    """Generate Prisma client in sandbox.

    Args:
        name: Target name
        schema: Label for the prisma schema file (e.g., "prisma/schema.prisma")
        deps: Additional dependencies
    """
    native.genrule(
        name = name,
        srcs = [schema] + deps,
        outs = [name + "_done"],
        cmd = "bunx prisma generate --schema=$(location %s) && touch $@" % schema,
        tags = ["requires-network"],
    )
