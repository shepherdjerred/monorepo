#!/usr/bin/env bash
set -Eeuo pipefail

# Dependency-free main-branch work selector. The tiny ci-selector-base step
# resolves the last green main commit once per build and stores it as Buildkite
# metadata, so heavyweight runtime images do not need curl or jq just to decide
# whether they can skip.
#
# Exit 0 means the lane is affected and should run. Exit 78 means the lane is
# unaffected and may skip. Any lookup, API, git, or selector failure fails open
# to exit 0 so a broken optimization can only do extra work, never lose CI.

lane=${1:-}
if [ -z "$lane" ]; then
  echo "Usage: ci-changed.sh <lane>" >&2
  exit 0
fi

trap 'status=$?; trap - ERR; echo "WARN: CI change selector failed for ${lane} (exit ${status}); running lane" >&2; declare -F record_decision >/dev/null && record_decision "ran — selector failed with exit ${status} (fail-open)"; exit 0' ERR

# Record this lane's run/skip decision as build meta-data so the main-only
# build-summary step can render one lane-decision table for the whole build.
# Best-effort by design: a meta-data failure must never change this script's
# exit code — the explicit if handles that one specific failure and keeps it
# out of the ERR trap's reach. Defined before base validation so every
# fail-open return below (unavailable/empty/stale base) records its own
# reason too — otherwise build-summary shows "not recorded" for exactly the
# builds where the selector failed open, losing the one signal that matters.
record_decision() {
  if [ "${BUILDKITE:-}" != "true" ]; then
    return 0
  fi
  if ! buildkite-agent meta-data set "ci-lane-decision-${lane}" "$1"; then
    echo "WARN: could not record lane decision for ${lane}" >&2
  fi
}

base=${CI_CHANGED_BASE:-}
if [ -z "$base" ]; then
  if ! base=$(buildkite-agent meta-data get ci-changed-base); then
    echo "WARN: ci-changed-base metadata is unavailable; running ${lane}" >&2
    record_decision "ran — ci-changed-base metadata unavailable (fail-open)"
    exit 0
  fi
  if [ -z "$base" ]; then
    echo "WARN: ci-changed-base metadata is empty; running ${lane}" >&2
    record_decision "ran — ci-changed-base metadata empty (fail-open)"
    exit 0
  fi
fi

if ! git cat-file -e "${base}^{commit}"; then
  echo "WARN: selector base ${base} is unavailable; running ${lane}" >&2
  record_decision "ran — selector base ${base} unavailable (fail-open)"
  exit 0
fi
if ! git merge-base --is-ancestor "$base" HEAD; then
  echo "WARN: selector base ${base} is not an ancestor of HEAD; running ${lane}" >&2
  record_decision "ran — selector base ${base} not an ancestor of HEAD (fail-open)"
  exit 0
fi

if [ "$lane" = "images" ]; then
  # --reasons-out writes the real base/changedPaths/targets to the same
  # filename bake-images.sh uses as its own SELECTION_REPORT. bake-images.sh
  # never runs on the skip path below, so this call is the ONLY producer of
  # that artifact then — without it, the pipeline step had to fabricate an
  # empty base/changedPaths, discarding the actual diff evidence this lookup
  # just computed.
  targets=$(bun --no-install .buildkite/scripts/select-image-targets.ts --base "$base" --reasons-out image-selection-report.json)
  if [ "$targets" = "[]" ]; then
    record_decision "skipped — no image closure affected since ${base}"
    echo "${lane}: unchanged since ${base}; skipping"
    exit 78
  fi
  record_decision "ran — selected targets ${targets}"
  echo "${lane}: selected targets ${targets}"
  exit 0
fi

global_paths=(
  .buildkite
  .mise.toml
  bun.lock
  bunfig.toml
  package.json
  patches
  turbo.json
)

# Per-site lane path lists, defined ONCE. The aggregate `sites` lane is
# derived as their union below so the two can never skew — a hand-maintained
# aggregate missing a path a per-site lane had (versions.ts) is exactly what
# broke the scout release pair in build 6281.
site_sjer_red_paths=(
  packages/sjer.red
  packages/astro-opengraph-images
  packages/webring
  scripts/deploy-site.ts
  scripts/lib/s3-static-site.ts
  scripts/lib/run.ts
)
site_resume_paths=(packages/resume scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
site_webring_paths=(packages/webring scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
site_cooklang_paths=(packages/cooklang-rich-preview scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
site_stocks_paths=(packages/stocks-sjer-red scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
site_better_skill_capped_paths=(packages/better-skill-capped scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
# glitter-context is a bundled workspace dependency of the glitter site (its
# people/relationship data is baked into the build), so a context-only refresh
# must redeploy the site. The images lane already covers the Birmel/Scout/
# temporal images via the workspace dependency closure in select-image-targets.ts.
site_glitter_paths=(packages/glitter packages/glitter-context scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
# docker-bake.hcl and .dockerignore are scout image-content inputs: a bake
# config change can alter the backend image without touching the scout
# tree, and the release-pair tag mint (scout-tag-release) requires a fresh
# site archive in the same build to pair with. Scout's frontend/data packages
# also bundle glitter-context, so a context-only refresh must rebuild and
# redeploy the scout site.
site_scout_paths=(
  packages/scout-for-lol
  packages/astro-opengraph-images
  packages/llm-models
  packages/glitter-context
  packages/homelab/src/cdk8s/src/versions.ts
  scripts/package.json
  scripts/scout-site-release.ts
  scripts/lib
  docker-bake.hcl
  .dockerignore
)

lane_paths=()
case "$lane" in
  playwright)
    lane_paths=(
      packages/sjer.red
      packages/astro-opengraph-images
      packages/webring
      packages/eslint-config
      scripts/deploy-site.ts
      scripts/lib/s3-static-site.ts
      scripts/lib/run.ts
    )
    ;;
  resume)
    lane_paths=(
      packages/resume
      scripts/deploy-site.ts
      scripts/lib/s3-static-site.ts
      scripts/lib/run.ts
    )
    ;;
  docker-e2e)
    lane_paths=(packages/llm-observability packages/eslint-config)
    ;;
  helm-types)
    lane_paths=(
      packages/homelab/src/cdk8s/src/versions.ts
      packages/homelab/src/cdk8s/scripts/generate-helm-types.ts
      packages/homelab/src/cdk8s/scripts/parse-helm-charts.ts
      packages/homelab/src/helm-types
      packages/homelab/src/cdk8s/generated/helm
    )
    ;;
  tofu)
    lane_paths=(
      packages/homelab/src/tofu
      packages/homelab/scripts/tofu-stack.ts
      scripts/lib/run.ts
      scripts/lib/transient.ts
    )
    ;;
  helm)
    lane_paths=(
      packages/homelab/src/cdk8s
      packages/homelab/scripts/helm-push.ts
      scripts/lib/run.ts
    )
    ;;
  argocd)
    lane_paths=(
      packages/homelab/src/cdk8s
      packages/homelab/scripts/argocd.ts
      scripts/lib/run.ts
      scripts/lib/transient.ts
    )
    ;;
  npm)
    lane_paths=(
      packages/astro-opengraph-images
      packages/webring
      packages/homelab/src/helm-types
      scripts/publish-npm.ts
      scripts/lib
    )
    ;;
  site-sjer-red)
    lane_paths=("${site_sjer_red_paths[@]}")
    ;;
  site-resume)
    lane_paths=("${site_resume_paths[@]}")
    ;;
  site-webring)
    lane_paths=("${site_webring_paths[@]}")
    ;;
  site-cooklang)
    lane_paths=("${site_cooklang_paths[@]}")
    ;;
  site-stocks)
    lane_paths=("${site_stocks_paths[@]}")
    ;;
  site-better-skill-capped)
    lane_paths=("${site_better_skill_capped_paths[@]}")
    ;;
  site-glitter)
    lane_paths=("${site_glitter_paths[@]}")
    ;;
  site-scout)
    lane_paths=("${site_scout_paths[@]}")
    ;;
  sites)
    # Union of every per-site lane (duplicates are harmless to git diff).
    lane_paths=(
      "${site_sjer_red_paths[@]}"
      "${site_resume_paths[@]}"
      "${site_webring_paths[@]}"
      "${site_cooklang_paths[@]}"
      "${site_stocks_paths[@]}"
      "${site_better_skill_capped_paths[@]}"
      "${site_glitter_paths[@]}"
      "${site_scout_paths[@]}"
    )
    ;;
  scout-reconcile)
    lane_paths=(
      packages/scout-for-lol
      packages/astro-opengraph-images
      packages/llm-models
      packages/homelab/src/cdk8s/src/versions.ts
      scripts/package.json
      scripts/scout-site-release.ts
      scripts/lib
    )
    ;;
  cooklang)
    lane_paths=(packages/cooklang-for-obsidian)
    ;;
  ci-image)
    lane_paths=(.buildkite/ci-image .buildkite/scripts/build-ci-image.sh .mise.toml)
    ;;
  *)
    echo "WARN: unknown CI selector lane ${lane}; running it" >&2
    exit 0
    ;;
esac

if git diff --quiet "$base" HEAD -- "${global_paths[@]}" "${lane_paths[@]}"; then
  record_decision "skipped — unchanged since ${base}"
  echo "${lane}: unchanged since ${base}; skipping"
  exit 78
else
  status=$?
fi
if [ "$status" -eq 1 ]; then
  decision="ran — changed since ${base}"
  if changed_files=$(git diff --name-only "$base" HEAD -- "${global_paths[@]}" "${lane_paths[@]}"); then
    changed_count=$(printf '%s\n' "$changed_files" | sed '/^$/d' | wc -l | tr -d ' ')
    # A live `printf | head -3` pipe risks SIGPIPE on large diffs: head exits
    # after 3 lines and closes its stdin while printf may still be writing,
    # which (under `set -o pipefail`) surfaces as this assignment failing and
    # trips the ERR trap before record_decision below ever runs. A here-string
    # has no concurrent producer to signal, so head reading only part of it is
    # never an error.
    changed_sample=$(head -3 <<<"$changed_files" | tr '\n' ' ')
    decision="ran — ${changed_count} matching change(s) since ${base}: ${changed_sample}"
  fi
  record_decision "$decision"
  echo "${lane}: changed since ${base}; running"
  exit 0
fi

echo "WARN: git diff failed for ${lane} (exit ${status}); running lane" >&2
record_decision "ran — git diff exited ${status} for ${lane} (fail-open)"
exit 0
