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
# Each Dockerfile owns a `smoke` stage. BuildKit executes that stage against
# the production filesystem with no image exporter; the production stage is
# pushed directly only after the smoke solve succeeds.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=.buildkite/scripts/bake-retry.sh
source "${SCRIPT_DIR}/bake-retry.sh"

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
# The homelab infra images are one unit: the `homelab` package owns all
# of them and its smoke script asserts on all of them.
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
INFRA_IMAGES=(bindery caddy-s3proxy obsidian-headless mcp-gateway redlib shelfbridge)
KNOWN_TARGETS_JSON=$(printf '%s\n' "${APP_TARGETS[@]%%|*}" infra | jq -R . | jq -s 'sort')

bake_targets=()
push_images=()

# Build-page justification side channel. The selector writes WHY each target
# was picked to this file; annotate-image-summary.ts renders it (and the push
# outcomes on main) as the `images` annotation. Both files are uploaded as
# build artifacts via the step's artifact_paths. Annotation failures must
# never change this script's exit code — the guard below handles that one
# specific failure explicitly and downgrades it to a warning.
SELECTION_REPORT="image-selection-report.json"
PUSH_OUTCOMES="image-push-outcomes.json"
rm -f "$SELECTION_REPORT" "$PUSH_OUTCOMES"

annotate_summary() {
  if ! bun --no-install .buildkite/scripts/annotate-image-summary.ts "$@"; then
    echo "WARN: image summary annotation failed (non-fatal)" >&2
  fi
}

# Scope selection. PRs diff against their merge-base with origin/main. Main
# diffs against the LAST GREEN MAIN BUILD's commit: every
# image validated+pushed at that commit is guaranteed output-identical here
# (digests are content-gated), so rebuilding it moves gigabytes through an
# ephemeral BuildKit for a no-op — most merges touch no image-owning package
# at all. If the lookup fails, degrade LOUDLY to building everything — more
# work, never a silent skip.
scope="all"
scope_base=""
fallback_reason="full build requested (no --affected/--push scoping)"
if [ "$AFFECTED_ONLY" = true ]; then
  if scope_base=$(git merge-base origin/main HEAD); then
    scope="affected"
  else
    echo "WARN: could not resolve merge-base with origin/main — building ALL images"
    fallback_reason="could not resolve merge-base with origin/main"
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
    fallback_reason="could not resolve last green main build"
  fi
fi

if [ "$scope" = "affected" ]; then
  # The dependency-free selector returns a deterministic JSON target list.
  # Any selector/tool/schema failure builds everything: selection can only
  # save work, never omit a required image.
  if selected_json=$(bun --no-install .buildkite/scripts/select-image-targets.ts --base "$scope_base" --reasons-out "$SELECTION_REPORT") \
    && printf '%s' "$selected_json" | jq -e --argjson known "$KNOWN_TARGETS_JSON" \
      'type == "array" and all(.[]; type == "string" and (. as $target | $known | index($target) != null))' >/dev/null; then
    echo "selected image targets: $selected_json"
  else
    echo "WARN: image selector failed — building ALL images"
    scope="all"
    fallback_reason="image selector failed (fail-open)"
    rm -f "$SELECTION_REPORT"
  fi

fi

is_selected() {
  printf '%s' "$selected_json" | jq -e --arg target "$1" \
    'index($target) != null' >/dev/null
}

if [ "$scope" = "affected" ]; then
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    if is_selected "$target"; then
      bake_targets+=("$target")
      push_images+=("$target")
    fi
  done
  if is_selected "infra"; then
    # `infra` is a Bake group, not an invokable target. Expand it before the
    # per-target smoke override so every image receives its own `smoke` stage.
    bake_targets+=("${INFRA_IMAGES[@]}")
    push_images+=("${INFRA_IMAGES[@]}")
  fi
  if [ "${#bake_targets[@]}" -eq 0 ]; then
    echo "no image-owning packages affected — nothing to build"
    annotate_summary --report "$SELECTION_REPORT"
    if [ "$PUSH" = true ]; then
      # The version commit-back step reads this unconditionally.
      jq -n '{}' | buildkite-agent meta-data set image-digests
      # ci-changed.sh images and this script diff against different bases (a
      # stale ci-changed-base vs. the freshest last-green-main lookup here), so
      # this script can still find nothing to push even when the outer gate
      # said "run". The images step declares image-push-outcomes.json as a
      # required artifact unconditionally — write the empty array so that
      # otherwise-successful no-op doesn't fail on artifact upload.
      jq -n '[]' > "$PUSH_OUTCOMES"
    fi
    exit 0
  fi
fi

if [ "$scope" = "all" ]; then
  selected_json=$KNOWN_TARGETS_JSON
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    bake_targets+=("$target")
    push_images+=("$target")
  done
  bake_targets+=("${INFRA_IMAGES[@]}")
  push_images+=("${INFRA_IMAGES[@]}")
fi

# Builds run on the persistent in-cluster buildkitd. Smoke solves have no
# exporter, so CI never materializes a second image graph in a job-local Docker
# daemon. Main pushes the already-warm production target directly to GHCR.
if ! docker buildx inspect ci; then
  docker buildx create --name ci --driver remote tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234
fi

smoke_target_args=()
for target in "${bake_targets[@]}"; do
  smoke_target_args+=(--set "${target}.target=smoke")
done
if [ -z "${CADDYFILE_SMOKE_PATH:-}" ] && is_selected "infra"; then
  echo "CADDYFILE_SMOKE_PATH is required when Caddy's in-image smoke runs" >&2
  exit 2
fi
if [ -n "${CADDYFILE_SMOKE_PATH:-}" ]; then
  # Buildx Bake protects host-file reads used by target secrets. Limit the
  # entitlement to the generated Caddyfile; it is never exported into an image.
  smoke_target_args+=(--allow "fs.read=${CADDYFILE_SMOKE_PATH}")
fi

# Bake with bounded retry + exponential backoff. Image builds do a lot of
# network I/O with no retry of their own — most notably `bun install` runs
# `@lng2004/node-datachannel`'s `prebuild-install`, which pulls a prebuilt
# binary from the GitHub-release CDN and, on a timeout, falls back to an `npm`
# source build the bun-base images can't do (exit 127). A single slow CDN
# response would otherwise sink the whole step and wait for a human to click
# "retry" (build 5967). buildx is idempotent — a retry re-uses cached layers and
# only re-attempts the failed one. A failure that STILL matches a transient
# signature after the in-script retries exits 34 (EXIT_TRANSIENT, matching
# scripts/lib/transient.ts) so the pipeline's `retry: *retry` anchor re-runs the
# step on a fresh agent; a non-transient build error fails fast (exit 1).
#
# Two guards against retrying a real error (bake runs targets in PARALLEL into
# one interleaved log): (1) the signatures are error-only — no bare
# `prebuild-install`, which appears in a *successful* target's normal output;
# only phrases that mean an operation actually errored. (2) we scan just the
# FAILURE TAIL: on a target failure buildx cancels the rest and prints that
# target's error at the end, so the tail is the failing target's output, not a
# sibling's benign mid-build noise. So a deterministic failure (e.g. a missing
# COPY source) in one target isn't masked as transient by another target's text.
# The classifier lives in bake-retry.sh so its bounded-tail behavior has direct
# regression coverage.

# Contract-source hash baked into the scout image (ENV CONTRACT_HASH) and
# stamped into the SPA bundle by the sites step — equal hashes at runtime
# mean the deployed frontend/backend pair shares a tRPC contract. The script
# is dependency-free, so it runs before any workspace install.
CONTRACT_HASH=$(bun --no-install packages/scout-for-lol/scripts/contract-hash.ts)
bake_attempt=1
bake_max=3
while :; do
  echo "--- :fire: in-image smoke ${bake_targets[*]} (attempt ${bake_attempt}/${bake_max})"
  bake_log="$(mktemp)"
  if VERSION=dev GIT_SHA=unknown CONTRACT_HASH="$CONTRACT_HASH" PUSH_CACHE=false \
      docker buildx bake --builder ci "${smoke_target_args[@]}" "${bake_targets[@]}" 2>&1 | tee "$bake_log"; then
    rm -f "$bake_log"
    break
  fi
  if ! bake_failure_is_transient "$bake_log"; then
    echo "^^^ +++ bake failed with a non-transient error — failing fast."
    rm -f "$bake_log"
    exit 1
  fi
  rm -f "$bake_log"
  if [ "$bake_attempt" -ge "$bake_max" ]; then
    echo "^^^ +++ bake still failing on a transient network error after ${bake_max} attempts — exiting 34 for a step-level retry."
    exit 34
  fi
  bake_backoff=$((bake_attempt * bake_attempt * 15))
  echo "^^^ +++ bake hit a transient network error; backing off ${bake_backoff}s then retrying."
  sleep "$bake_backoff"
  bake_attempt=$((bake_attempt + 1))
done

if [ "$PUSH" = true ]; then
  VERSIONS_TS="packages/homelab/src/cdk8s/src/versions.ts"
  # Images whose /prod pin in versions.ts is Renovate-managed (docker
  # datasource): Renovate can only offer tags that exist in the registry, so
  # push a versioned tag whenever a content change records a digest — the same
  # 2.0.0-<build> the version commit-back writes to the beta pin.
  # scout-for-lol is deliberately absent: its versioned tag is the atomic
  # backend+site release pair, minted by the scout-tag-release step only after
  # the paired site archive exists.
  VERSIONED_TAG_IMAGES=(starlight-karma-bot)
  digest_args=()
  outcome_entries=()
  echo "--- :arrow_up: push production targets ${bake_targets[*]}"
  VERSION="$BUILD_NUMBER" GIT_SHA="$SHA" CONTRACT_HASH="$CONTRACT_HASH" PUSH_CACHE=true PUSH_IMAGES=true \
    docker buildx bake --builder ci --push "${bake_targets[@]}"
  for name in "${push_images[@]}"; do
    # Record the pushed manifest digest for the version commit-back step
    # (versions.ts pins tag@digest). buildx 0.30.x (the ci-image pin) silently
    # ignores the '{{.Manifest.Digest}}' template and prints the full
    # human-readable inspect output (build 6296 shipped that text into
    # image-digests); the JSON form is honored by 0.30 and 0.33 alike, and the
    # shape assert keeps any future format regression from reaching meta-data.
    digest=$(docker buildx imagetools inspect "${REGISTRY}/${name}:${SHA}" --format '{{json .Manifest}}' | jq -r '.digest')
    if ! printf '%s' "$digest" | grep -Eq '^sha256:[a-f0-9]{64}$'; then
      echo "no valid manifest digest for ${REGISTRY}/${name}:${SHA} after push (got: ${digest})" >&2
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
      # skipped one. These images are single-platform, so a pinned digest always resolves
      # to an image manifest: .Image is populated and .Image.RootFS.DiffIDs is
      # a real array, never the `null` that a multi-platform manifest-list
      # index would yield.
      if old_layers=$(docker buildx imagetools inspect "${REGISTRY}/${name}@${pinned}" --format '{{json .Image.RootFS.DiffIDs}}' | jq -c .); then
        new_layers=$(docker buildx imagetools inspect "${REGISTRY}/${name}:${SHA}" --format '{{json .Image.RootFS.DiffIDs}}' | jq -c .)
        if [ "$old_layers" = "$new_layers" ]; then
          echo "content unchanged vs pinned ${pinned} (identical rootfs) — no version bump for ${name}"
          outcome_entries+=("${name}|content-unchanged")
          continue
        fi
        echo "content CHANGED vs pinned ${pinned} — will bump ${name}"
        outcome_entries+=("${name}|bumped")
      else
        echo "pinned digest ${pinned} for ${name} not resolvable — treating as changed"
        outcome_entries+=("${name}|pin-unresolvable-bumped")
      fi
    else
      echo "no existing versions.ts pin found for ${name} — will bump"
      outcome_entries+=("${name}|no-pin-bumped")
    fi
    for versioned in "${VERSIONED_TAG_IMAGES[@]}"; do
      if [ "$name" = "$versioned" ]; then
        docker buildx imagetools create --tag "${REGISTRY}/${name}:2.0.0-${BUILD_NUMBER}" "${REGISTRY}/${name}:${SHA}"
      fi
    done
    digest_args+=(--arg "shepherdjerred/${name}" "$digest")
  done
  # One JSON object {"shepherdjerred/<image>": "sha256:..."} via build
  # meta-data, consumed by the version commit-back step. May be empty when
  # no image's content changed — the commit-back then no-ops.
  jq -n '$ARGS.named' "${digest_args[@]}" | buildkite-agent meta-data set image-digests
  if [ "${#outcome_entries[@]}" -gt 0 ]; then
    printf '%s\n' "${outcome_entries[@]}" \
      | jq -R 'split("|") | {image: .[0], outcome: .[1]}' | jq -s . > "$PUSH_OUTCOMES"
  fi
fi

# Every fail-open path above (unresolvable merge-base/last-green lookup, or a
# distrusted selector result) leaves scope="all" without a $SELECTION_REPORT —
# both callers declare that file as a required artifact_paths entry, and an
# unmatched artifact path fails the step even after a successful full build.
# Reconstruct a mode="all" report here so the file always exists whenever this
# script produces output, regardless of which fallback triggered "all".
if [ "$scope" = "all" ] && [ ! -f "$SELECTION_REPORT" ]; then
  jq -n --argjson targets "$KNOWN_TARGETS_JSON" --arg reason "$fallback_reason" \
    '{base: null, changedPaths: [], mode: "all", globalReason: $reason,
      targets: ($targets | map({(.): [$reason]}) | add)}' \
    > "$SELECTION_REPORT"
fi

# Build-page justification: render the selection reasons (and push outcomes on
# main) as the `images` annotation. Never affects the step's exit code.
annotate_args=()
if [ -f "$SELECTION_REPORT" ]; then
  annotate_args+=(--report "$SELECTION_REPORT")
else
  annotate_args+=(--fallback "$fallback_reason")
fi
if [ -f "$PUSH_OUTCOMES" ]; then
  annotate_args+=(--outcomes "$PUSH_OUTCOMES")
fi
annotate_summary "${annotate_args[@]}"
