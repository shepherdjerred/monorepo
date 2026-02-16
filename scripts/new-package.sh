#!/bin/bash
set -euo pipefail

PACKAGE_NAME="$1"
PACKAGE_DIR="packages/$PACKAGE_NAME"

if [ -d "$PACKAGE_DIR" ]; then
  echo "Error: Package $PACKAGE_NAME already exists"
  exit 1
fi

mkdir -p "$PACKAGE_DIR/src"

# package.json
cat > "$PACKAGE_DIR/package.json" << EOF
{
  "name": "@shepherdjerred/$PACKAGE_NAME",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "true",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "bunx eslint ."
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
EOF

# eslint.config.ts
cat > "$PACKAGE_DIR/eslint.config.ts" << EOF
import { recommended } from "../eslint-config/local.ts";
export default recommended({ tsconfigRootDir: import.meta.dirname });
EOF

# tsconfig.json
cat > "$PACKAGE_DIR/tsconfig.json" << EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src"]
}
EOF

# src/index.ts
cat > "$PACKAGE_DIR/src/index.ts" << 'EOF'
export {};
EOF

echo "Created package: $PACKAGE_NAME"
echo "Run 'bun install' to link workspace dependencies"
