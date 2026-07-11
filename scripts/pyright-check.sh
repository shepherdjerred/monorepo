#!/usr/bin/env bash
# Pyright strict over the repo's Python (root pyrightconfig.json).
# Bootstraps the shared dev venv from scripts/python-dev-requirements.txt so
# third-party imports resolve. Requires uv (installed by mise).
set -euo pipefail

PYRIGHT_VERSION="1.1.411" # keep in sync with .dagger/src/constants.ts

if [ ! -x .venv/bin/python ]; then
  echo "Creating Python dev venv (.venv) for pyright..."
  uv venv --python 3.12 .venv
fi
uv pip install --quiet -r scripts/python-dev-requirements.txt --python .venv/bin/python

uvx "pyright@${PYRIGHT_VERSION}"
