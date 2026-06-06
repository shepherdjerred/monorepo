#!/usr/bin/env bash
set -euo pipefail

# Refreshes the vendored pokeemerald.wasm emulator blob and opens a PR when it
# changed. Intended to run on a monthly Buildkite Schedule (configured in the
# Buildkite UI, like update-readmes). Mirrors update-readmes.sh.

source "$(dirname "$0")/setup-tools.sh"

install_base
install_gh
install_bun

# Validate required env vars
: "${BUILDKITE_BRANCH:?Required}"
: "${GITHUB_APP_ID:?Required}"
: "${GITHUB_APP_INSTALLATION_ID:?Required}"
: "${GITHUB_APP_PRIVATE_KEY:?Required}"

echo "--- :github: Minting GitHub App installation token"
export GH_TOKEN
GH_TOKEN="$(bun packages/temporal/src/lib/github-app-token.ts)"

REPO="shepherdjerred/monorepo"
BASE_BRANCH="${BUILDKITE_BRANCH}"
BRANCH="auto/update-pokeemerald-wasm"
WASM="packages/discord-plays-pokemon/packages/backend/assets/pokeemerald.wasm"

git config --global user.name "github-actions[bot]"
git config --global user.email "github-actions[bot]@users.noreply.github.com"
git config --global core.hooksPath /dev/null

GIT_ASKPASS_SCRIPT="$(mktemp)"
printf '#!/bin/sh\necho "%s"\n' "${GH_TOKEN}" > "${GIT_ASKPASS_SCRIPT}"
chmod +x "${GIT_ASKPASS_SCRIPT}"
export GIT_ASKPASS="${GIT_ASKPASS_SCRIPT}"
git remote set-url origin "https://git@github.com/${REPO}.git"

echo "+++ :pokemon: Refreshing ${WASM}"
FORCE=1 bun packages/discord-plays-pokemon/scripts/fetch-wasm.ts

if git diff --quiet -- "${WASM}"; then
  echo "pokeemerald.wasm is unchanged."
  exit 0
fi

git checkout -B "${BRANCH}"
git add "${WASM}"
LEFTHOOK=0 HUSKY=0 git commit -m "chore(discord-plays-pokemon): update pokeemerald.wasm"
git push --force origin "${BRANCH}"

OPEN_PR_COUNT="$(gh pr list --repo "${REPO}" --state open --head "${BRANCH}" --json number --jq 'length')"
if [ "$OPEN_PR_COUNT" -eq 0 ]; then
  gh pr create \
    --repo "${REPO}" \
    --title "chore(discord-plays-pokemon): update pokeemerald.wasm" \
    --body "Automated monthly refresh of the vendored pokeemerald.wasm emulator blob from pokeemerald.com." \
    --head "${BRANCH}" \
    --base "${BASE_BRANCH}"
else
  echo "Open PR already exists for ${BRANCH}"
fi
