#!/bin/bash
# https://www.chezmoi.io/user-guide/advanced/use-chezmoi-with-watchman/

CHEZMOI_SOURCE_PATH="$(chezmoi source-path)"
watchman watch "${CHEZMOI_SOURCE_PATH}"
