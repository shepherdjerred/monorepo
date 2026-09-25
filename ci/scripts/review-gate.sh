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
# old. It also holds against a deliberate one, which the Buildkite arrangement
# did not: the configuration extension serves the step model baked into its
# deployed image rather than the one on the branch under test, so a branch
# cannot rewrite this step, its command, or the secrets it is granted. The
# extension additionally refuses to generate a pipeline at all for anyone but
# the owner and his bots (see `src/authorization.ts` in that package), so the
# gate is only ever measuring a change that one of them pushed.
#
# REVIEW_GATE_REF exists so a change to the gate itself can be exercised before
# it lands, since once this is in place the gate no longer runs a PR's own
# version of it. Set it when creating the build, the way CI_IO_FIXED_CORPUS is
# set; leave it unset everywhere else.

GATE_REF="${REVIEW_GATE_REF:-main}"
GATE_DIR="${CI_WORKSPACE:-$PWD}/.review-gate-source"

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
BUN_INSTALL_LOCK_MODE=shared "$GATE_DIR/ci/scripts/bun-install.sh" --frozen-lockfile \
  --filter '@shepherdjerred/root-scripts' --production

WAIT_SCRIPT="$GATE_DIR/scripts/review/wait-for-review.ts"
if [[ ! -f "$WAIT_SCRIPT" ]]; then
  echo "review gate: wait-for-review.ts is absent from the fetched main source" >&2
  exit 1
fi

# Exit status 42 is the gate's "the provider declared it cannot review at all"
# (quota exhaustion) status, REVIEW_GATE_BLOCKED_EXIT_CODE in
# @shepherdjerred/code-review. No review happened, so it is not a review
# failure, and blocking every merge on a billing state would stop the rest of
# CI from counting. Woodpecker cannot soft-fail a step on one exit status, so
# the gate does it here: 42 passes with a warning in the log, and every other
# non-zero status (findings, unresolved threads, timeouts, errors) fails.
QUOTA_EXIT_STATUS=42
if GH_TOKEN="$GITHUB_REVIEW_TOKEN" \
  REVIEW_GATE_PARSER_COMMIT="$GATE_SHA" \
  bun --no-install "$WAIT_SCRIPT"; then
  exit 0
else
  GATE_STATUS=$?
fi

if [[ "$GATE_STATUS" -eq "$QUOTA_EXIT_STATUS" ]]; then
  PROVIDER_NAME="${REVIEW_PROVIDER:-codex}"
  echo "WARNING: ${PROVIDER_NAME} review skipped: out of quota. The review gate passed without a review because ${PROVIDER_NAME} reported its usage limit for this head. Rely on Greptile's review for this PR, or add ${PROVIDER_NAME} credits and restart this workflow to get a ${PROVIDER_NAME} review." >&2
  exit 0
fi
exit "$GATE_STATUS"
