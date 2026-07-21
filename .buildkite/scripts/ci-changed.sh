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

trap 'status=$?; trap - ERR; echo "WARN: CI change selector failed for ${lane} (exit ${status}); running lane" >&2; exit 0' ERR

base=${CI_CHANGED_BASE:-}
if [ -z "$base" ]; then
  if ! base=$(buildkite-agent meta-data get ci-changed-base); then
    echo "WARN: ci-changed-base metadata is unavailable; running ${lane}" >&2
    exit 0
  fi
  if [ -z "$base" ]; then
    echo "WARN: ci-changed-base metadata is empty; running ${lane}" >&2
    exit 0
  fi
fi

if ! git cat-file -e "${base}^{commit}"; then
  echo "WARN: selector base ${base} is unavailable; running ${lane}" >&2
  exit 0
fi
if ! git merge-base --is-ancestor "$base" HEAD; then
  echo "WARN: selector base ${base} is not an ancestor of HEAD; running ${lane}" >&2
  exit 0
fi

if [ "$lane" = "images" ]; then
  targets=$(bun .buildkite/scripts/select-image-targets.ts --base "$base")
  if [ "$targets" = "[]" ]; then
    echo "${lane}: unchanged since ${base}; skipping"
    exit 78
  fi
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
    lane_paths=(
      packages/sjer.red
      packages/astro-opengraph-images
      packages/webring
      scripts/deploy-site.ts
      scripts/lib/s3-static-site.ts
      scripts/lib/run.ts
    )
    ;;
  site-resume)
    lane_paths=(packages/resume scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
    ;;
  site-webring)
    lane_paths=(packages/webring scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
    ;;
  site-cooklang)
    lane_paths=(packages/cooklang-rich-preview scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
    ;;
  site-stocks)
    lane_paths=(packages/stocks-sjer-red scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
    ;;
  site-better-skill-capped)
    lane_paths=(packages/better-skill-capped scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
    ;;
  site-glitter)
    lane_paths=(packages/glitter scripts/deploy-site.ts scripts/lib/s3-static-site.ts scripts/lib/run.ts)
    ;;
  site-scout)
    lane_paths=(
      packages/scout-for-lol
      packages/homelab/src/cdk8s/src/versions.ts
      scripts/scout-site-release.ts
      scripts/lib
    )
    ;;
  sites)
    lane_paths=(
      packages/sjer.red
      packages/resume
      packages/webring
      packages/astro-opengraph-images
      packages/cooklang-rich-preview
      packages/stocks-sjer-red
      packages/better-skill-capped
      packages/glitter
      packages/scout-for-lol
      scripts/deploy-site.ts
      scripts/scout-site-release.ts
      scripts/lib/s3-static-site.ts
      scripts/lib/run.ts
    )
    ;;
  scout-promotion)
    lane_paths=(
      packages/scout-for-lol
      packages/homelab/src/cdk8s/src/versions.ts
      scripts/promote-scout.ts
      scripts/lib
    )
    ;;
  scout-reconcile)
    lane_paths=(
      packages/scout-for-lol
      packages/homelab/src/cdk8s/src/versions.ts
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
  echo "${lane}: unchanged since ${base}; skipping"
  exit 78
else
  status=$?
fi
if [ "$status" -eq 1 ]; then
  echo "${lane}: changed since ${base}; running"
  exit 0
fi

echo "WARN: git diff failed for ${lane} (exit ${status}); running lane" >&2
exit 0
