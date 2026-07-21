#!/usr/bin/env bash
set -euo pipefail

# Build (+ smoke, + optionally push) the service/infra images via `docker
# buildx bake` (docker-bake.hcl at the repo root) — targets build in PARALLEL
# on one BuildKit daemon, replacing the old serial per-image loop.
#
#   --affected   PR mode: only bake targets whose owned workspace closure is
#                affected, selected without Turbo or node_modules.
#   --push       main mode: write per-target registry cache and push
#                :<sha> + :latest for every image after its smoke passes.
#
# Smoke scripts are invoked directly (not through `turbo run smoke`): the
# images are pre-built by bake, and turbo's smoke/docker:build tasks are
# cache:false, so no turbo caching is lost by bypassing the task graph.

REGISTRY="ghcr.io/shepherdjerred"
SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"
BUILD_NUMBER="${BUILDKITE_BUILD_NUMBER:?BUILDKITE_BUILD_NUMBER is required}"

AFFECTED_ONLY=false
PUSH=false
for arg in "$@"; do
  case "$arg" in
    --affected) AFFECTED_ONLY=true ;;
    --push) PUSH=true ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# bake target → package dir with the `smoke` script.
# The four homelab infra images are one unit: the `homelab` package owns all
# of them and its smoke script asserts on all four.
APP_TARGETS=(
  "birmel|packages/birmel"
  "tasknotes-server|packages/tasknotes-server"
  "starlight-karma-bot|packages/starlight-karma-bot"
  "streambot|packages/streambot"
  "temporal-worker|packages/temporal"
  "trmnl-dashboard|packages/trmnl-dashboard"
  "scout-for-lol|packages/scout-for-lol/packages/backend"
  "discord-plays-pokemon|packages/discord-plays-pokemon/packages/backend"
  "discord-plays-mario-kart|packages/discord-plays-mario-kart/packages/backend"
)
INFRA_IMAGES=(caddy-s3proxy obsidian-headless mcp-gateway redlib)
KNOWN_TARGETS_JSON=$(printf '%s\n' "${APP_TARGETS[@]%%|*}" infra | jq -R . | jq -s 'sort')

bake_targets=()
smoke_dirs=()
push_images=()

# Scope selection. PRs diff against their merge-base with origin/main. Main
# diffs against the LAST GREEN MAIN BUILD's commit: every
# image validated+pushed at that commit is guaranteed output-identical here
# (digests are content-gated), so rebuilding it moves gigabytes through an
# ephemeral BuildKit for a no-op — most merges touch no image-owning package
# at all. If the lookup fails, degrade LOUDLY to building everything — more
# work, never a silent skip.
scope="all"
scope_base=""
if [ "$AFFECTED_ONLY" = true ]; then
  if scope_base=$(git merge-base origin/main HEAD); then
    scope="affected"
  else
    echo "WARN: could not resolve merge-base with origin/main — building ALL images"
  fi
elif [ "$PUSH" = true ]; then
  if resp=$(curl -fsS --connect-timeout 5 --max-time 20 --retry 2 --retry-delay 1 \
      -H "Authorization: Bearer ${BUILDKITE_API_TOKEN}" \
      "https://api.buildkite.com/v2/organizations/sjerred/pipelines/monorepo/builds?branch=main&state=passed&per_page=1") \
    && last_green=$(printf '%s' "$resp" | jq -r '.[0].commit // empty') \
    && [ -n "$last_green" ] \
    && git cat-file -e "${last_green}^{commit}"; then
    scope="affected"
    scope_base="$last_green"
    echo "images scoped to changes since last green main build ($last_green)"
  else
    echo "WARN: could not resolve last green main build — building ALL images"
  fi
fi

if [ "$scope" = "affected" ]; then
  # The dependency-free selector returns a deterministic JSON target list.
  # Any selector/tool/schema failure builds everything: selection can only
  # save work, never omit a required image.
  if selected_json=$(bun .buildkite/scripts/select-image-targets.ts --base "$scope_base") \
    && printf '%s' "$selected_json" | jq -e --argjson known "$KNOWN_TARGETS_JSON" \
      'type == "array" and all(.[]; type == "string" and (. as $target | $known | index($target) != null))' >/dev/null; then
    echo "selected image targets: $selected_json"
  else
    echo "WARN: image selector failed — building ALL images"
    scope="all"
  fi

fi

is_selected() {
  printf '%s' "$selected_json" | jq -e --arg target "$1" \
    'index($target) != null' >/dev/null
}

if [ "$scope" = "affected" ]; then
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    dir="${entry#*|}"
    if is_selected "$target"; then
      bake_targets+=("$target")
      smoke_dirs+=("$dir")
      push_images+=("$target")
    fi
  done
  if is_selected "infra"; then
    bake_targets+=("infra")
    smoke_dirs+=("packages/homelab")
    push_images+=("${INFRA_IMAGES[@]}")
  fi
  if [ "${#bake_targets[@]}" -eq 0 ]; then
    echo "no image-owning packages affected — nothing to build"
    if [ "$PUSH" = true ]; then
      # The version commit-back step reads this unconditionally.
      jq -n '{}' | buildkite-agent meta-data set image-digests
    fi
    exit 0
  fi
fi

if [ "$scope" = "all" ]; then
  selected_json=$KNOWN_TARGETS_JSON
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    dir="${entry#*|}"
    bake_targets+=("$target")
    smoke_dirs+=("$dir")
    push_images+=("$target")
  done
  bake_targets+=("infra")
  smoke_dirs+=("packages/homelab")
  push_images+=("${INFRA_IMAGES[@]}")
fi

# Registry cache export needs a docker-container builder — dind's default
# docker driver cannot export cache. Used in both modes so the PR dry-run
# rehearses exactly what main runs, including the --load transfer.
if ! docker buildx inspect ci; then
  docker buildx create --name ci --driver docker-container
fi

PUSH_CACHE=false
if [ "$PUSH" = true ]; then
  PUSH_CACHE=true
fi
echo "--- :docker: bake ${bake_targets[*]}"
VERSION="$BUILD_NUMBER" GIT_SHA="$SHA" PUSH_CACHE="$PUSH_CACHE" \
  docker buildx bake --builder ci --load "${bake_targets[@]}"

# Smoke serially (containers contend on the daemon; assertions are cheap).
for dir in "${smoke_dirs[@]}"; do
  echo "--- :fire: smoke ${dir}"
  if [ -n "${CADDYFILE_SMOKE_PATH:-}" ]; then
    CADDYFILE_SMOKE_PATH="$CADDYFILE_SMOKE_PATH" bun run --cwd "$dir" smoke
  else
    bun run --cwd "$dir" smoke
  fi
done

if [ "$PUSH" = true ]; then
  VERSIONS_TS="packages/homelab/src/cdk8s/src/versions.ts"
  digest_args=()
  for name in "${push_images[@]}"; do
    echo "--- :arrow_up: push ${name}"
    docker tag "${name}:dev" "${REGISTRY}/${name}:${SHA}"
    docker tag "${name}:dev" "${REGISTRY}/${name}:latest"
    docker push "${REGISTRY}/${name}:${SHA}"
    docker push "${REGISTRY}/${name}:latest"
    # Record the pushed manifest digest for the version commit-back step
    # (versions.ts pins tag@digest).
    digest=$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${REGISTRY}/${name}:${SHA}" \
      | grep -m1 "^${REGISTRY}/${name}@" | cut -d@ -f2)
    if [ -z "$digest" ]; then
      echo "no repo digest recorded for ${REGISTRY}/${name}:${SHA} after push" >&2
      exit 1
    fi
    # CONTENT gate, not manifest gate: VERSION/GIT_SHA are baked into every
    # image's config, so the MANIFEST digest changes every build even for
    # byte-identical content — gating the version bump on it would make each
    # bump build produce "new" digests and open the next bump PR forever
    # (the image-flavored version of the cooklang release loop; the old CI
    # avoided it only via change detection). The rootfs layer chain ignores
    # config-only changes: identical content => identical layers. Compare the
    # fresh image's layers against the currently-pinned digest's and only
    # report a digest when the CONTENT differs.
    pinned=""
    for key in "shepherdjerred/${name}" "shepherdjerred/${name}/beta"; do
      if pin_lines=$(grep -A1 "\"${key}\"" "$VERSIONS_TS"); then
        if pinned=$(printf '%s' "$pin_lines" | grep -om1 "sha256:[a-f0-9]*"); then
          break
        fi
      fi
    done
    if [ -n "$pinned" ]; then
      # imagetools failure (e.g. a placeholder pin that was never pushed)
      # counts as changed — the safe direction is an extra bump, never a
      # skipped one. These images are single-platform (bake runs with --load,
      # which only supports one platform), so a pinned digest always resolves
      # to an image manifest: .Image is populated and .Image.RootFS.DiffIDs is
      # a real array, never the `null` that a multi-platform manifest-list
      # index would yield.
      if old_layers=$(docker buildx imagetools inspect "${REGISTRY}/${name}@${pinned}" --format '{{json .Image.RootFS.DiffIDs}}' | jq -c .); then
        # imagetools pretty-prints its JSON while docker inspect emits compact
        # JSON, so normalize both before comparing the same uncompressed IDs.
        new_layers=$(docker inspect --format '{{json .RootFS.Layers}}' "${name}:dev" | jq -c .)
        if [ "$old_layers" = "$new_layers" ]; then
          echo "content unchanged vs pinned ${pinned} (identical rootfs) — no version bump for ${name}"
          continue
        fi
        echo "content CHANGED vs pinned ${pinned} — will bump ${name}"
      else
        echo "pinned digest ${pinned} for ${name} not resolvable — treating as changed"
      fi
    else
      echo "no existing versions.ts pin found for ${name} — will bump"
    fi
    digest_args+=(--arg "shepherdjerred/${name}" "$digest")
  done
  # One JSON object {"shepherdjerred/<image>": "sha256:..."} via build
  # meta-data, consumed by the version commit-back step. May be empty when
  # no image's content changed — the commit-back then no-ops.
  jq -n '$ARGS.named' "${digest_args[@]}" | buildkite-agent meta-data set image-digests
fi
