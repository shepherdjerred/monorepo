#!/bin/bash
set -e

cd "$CLAUDE_PROJECT_DIR"

# Install dependencies
bun install

# Generate Prisma client only if schema changed
SCHEMA_FILE="packages/backend/prisma/schema.prisma"
GENERATED_SCHEMA="packages/backend/generated/prisma/client/schema.prisma"

if [ ! -f "$GENERATED_SCHEMA" ] || ! diff -q "$SCHEMA_FILE" "$GENERATED_SCHEMA" > /dev/null 2>&1; then
  bun run generate
fi
