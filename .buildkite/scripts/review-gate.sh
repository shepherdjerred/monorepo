#!/usr/bin/env bash
set -euo pipefail

# Run the review gate from `main` rather than from the pull request's own
# checkout.
#
# The gate reads only GitHub state — the provider's review, its findings, and
# whether they are resolved. It never reads the PR's diff. So there is no reason
# for it to run the PR's copy of itself, and one strong reason not to: with
# `@shepherdjerred/code-review` linked as a workspace dependency, a branch was
# graded by whatever version of the grader that branch happened to contain.
#
# PR #1389 is the worked example. Its branch was 22 commits behind and predated
# `currentReviewOf`, the function that excludes Qodo's archived
# "previous results" section, so its gate counted stale pre-fix copies of
# findings that had already been fixed: 0 blocking findings measured against
# current `main`, 3 measured by the branch's own parser. Nothing about the PR
# was wrong, and no amount of fixing the PR could have cleared it — only
# rebasing 22 commits of unrelated history would have.
#
# This closes the accidental version of that problem, where a branch is simply
# old. It is not a trust boundary: Buildkite uploads the pipeline from the
# branch, so a branch that deliberately rewrites this step controls its own
# gate either way — as it does for every other check.
#
# During the one-time Qodo-to-Codex rollout, `main` may not yet know that
# `REVIEW_PROVIDER=codex` is valid. In that case the Codex invocation uses only
# the PR checkout's provider-selection boundary, after verifying the expected
# migration marker; the review parser and all provider logic still come from
# this fetched `main` worktree. Once `main` accepts Codex, this compatibility
# path is unreachable and the normal main-sourced gate resumes automatically.
# It exists to let the provider boundary land atomically without making PR
# branches the permanent source of their own review gate.
#
# REVIEW_GATE_REF exists so a change to the gate itself can be exercised before
# it lands, since once this is in place the gate no longer runs a PR's own
# version of it. Set it when creating the build, the way CI_IO_FIXED_CORPUS is
# set; leave it unset everywhere else.

GATE_REF="${REVIEW_GATE_REF:-main}"
GATE_DIR="${BUILDKITE_BUILD_CHECKOUT_PATH:-$PWD}/.review-gate-source"

echo "~~~ Fetching the review gate from ${GATE_REF}"
# `--` so an operator-supplied REVIEW_GATE_REF beginning with `-` is fetched as
# a ref rather than parsed as a git option.
git fetch --depth 1 origin -- "$GATE_REF"
GATE_SHA="$(git rev-parse FETCH_HEAD)"
echo "Review gate source: ${GATE_REF} @ ${GATE_SHA}"

# Clear any leftover worktree on the way IN rather than removing it afterwards.
# Cleaning up first is idempotent and keeps the gate's exit status its own: a
# teardown failure cannot red a PR, and nothing has to be suppressed to make
# that true. The agent discards the workspace after the job regardless.
#
# The directory goes before the prune, not after: `git worktree prune` drops the
# registrations whose working tree is already gone, so pruning first cannot
# clear the one this run is about to delete. On a reused checkout that left the
# registration behind, `git worktree add` then refuses the path as already
# registered and the gate fails before it reads anything.
rm -rf "$GATE_DIR"
git worktree prune
git worktree add --detach "$GATE_DIR" FETCH_HEAD

cd "$GATE_DIR"
"$GATE_DIR/.buildkite/scripts/bun-install.sh" --frozen-lockfile \
  --filter '@shepherdjerred/root-scripts' --production

WAIT_SCRIPT="$GATE_DIR/scripts/wait-for-review.ts"
if [[ "${REVIEW_PROVIDER:-qodo}" == "codex" ]] && \
  ! grep -Fq 'ciProviders = new Set(["qodo", "codex"])' "$WAIT_SCRIPT"; then
  PR_WAIT_SCRIPT="${BUILDKITE_BUILD_CHECKOUT_PATH:-$PWD}/scripts/wait-for-review.ts"
  if [[ ! -f "$PR_WAIT_SCRIPT" ]] || \
    ! grep -Fq 'ciProviders = new Set(["qodo", "codex"])' "$PR_WAIT_SCRIPT"; then
    echo "Codex gate bootstrap requires the PR provider boundary to be present" >&2
    exit 1
  fi
  echo "Codex gate bootstrap: main lacks Codex acceptance; using the PR provider boundary with the main parser"
  cp "$PR_WAIT_SCRIPT" "$GATE_DIR/.review-gate-wait-for-review.ts"
  WAIT_SCRIPT="$GATE_DIR/.review-gate-wait-for-review.ts"
fi

REVIEW_GATE_PARSER_COMMIT="$GATE_SHA" bun --no-install "$WAIT_SCRIPT"
