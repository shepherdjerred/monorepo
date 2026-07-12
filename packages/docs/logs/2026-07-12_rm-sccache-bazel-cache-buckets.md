# Remove Bazel: retired cache buckets + dead build files, tooling & config

## Status

Complete

## Context

The `sccache` and `bazel-cache` SeaweedFS S3 buckets are leftovers from the
retired Bazel/sccache build tooling (the repo has since moved CI to Dagger; see
`packages/docs/archive/bazel/` and `packages/docs/plans/2026-07-11_ci-replatform-dagger-exit.md`).
They had no live consumers, but kept reappearing after manual deletion because
both were declared as OpenTofu resources in
`packages/homelab/src/tofu/seaweedfs/buckets.tf`. Any `tofu apply` of the
`seaweedfs` stack — which now runs automatically in CI on homelab changes — saw
the missing bucket as drift and re-`CreateBucket`d it. Deleting the bucket by
hand without removing the resource is a losing game.

## Verification that removal is safe

- **No live consumers.** `rg` for `RUSTC_WRAPPER`/`SCCACHE_*`/`sccache` and
  `bazel-cache`/`remote_cache`/`.bazelrc` across the tree (excluding docs,
  archive, skills) returned nothing. Only a stray dead `packages/cooklang-for-obsidian/BUILD.bazel`
  remains, which is not a cache consumer.
- **Standalone resources.** Neither bucket is referenced by any output or other
  resource in the `seaweedfs` tofu module; each only had its own
  `terraform_data` lifecycle block.
- **Clean tofu destroy on next apply.** SeaweedFS honors a single S3
  `DeleteBucket` on a non-empty collection (evidence: the 2026-07-05 relay-docs
  incident, where a tofu destroy issued `delete collection: collection:"relay-docs"`
  and removed 7 populated volumes). So plain resource removal → the next
  `seaweedfs`-stack apply destroys both buckets, data and all — no
  `force_destroy` and no manual pre-emptying required. Since these are disposable
  caches, deleting the data is the intent.

## Changes

- `packages/homelab/src/tofu/seaweedfs/buckets.tf`: removed
  `aws_s3_bucket.sccache` + `terraform_data.sccache_lifecycle` and
  `aws_s3_bucket.bazel_cache` + `terraform_data.bazel_cache_lifecycle`.
- Deleted `packages/homelab/scripts/seaweedfs/setup-sccache-bucket.sh` (the
  orphaned bucket-setup script; its lifecycle was already superseded by the
  now-removed `terraform_data`).
- `packages/homelab/src/tofu/README.md`: dropped the "build cache (sccache)"
  mention and the `setup-sccache-bucket.sh` sentence from the SeaweedFS section.

## Verification

- `tofu fmt -check seaweedfs/` → OK
- `tofu -chdir=seaweedfs init -backend=false && tofu -chdir=seaweedfs validate`
  → "Success! The configuration is valid."

## Deploy note

On merge, the `seaweedfs`-stack `tofu apply` in CI will **destroy** both buckets
(and their contents). No manual step required. There is no rollback of the
cached data, which is intended.

## Bazel code sweep (repo-wide)

Bazel was fully removed from CI (now Dagger). This scope grew to delete the
remaining dead Bazel artifacts across the repo. Confirmed `tools/rules_bun` and
all `.bzl`/`WORKSPACE`/`MODULE.bazel` files were already gone, so what remained
were orphans.

**Removed (actual Bazel code / tooling / config):**

- `packages/cooklang-for-obsidian/BUILD.bazel` — the last `BUILD.bazel`, a
  dangling orphan loading `//tools/rules_bun/...` (that rules dir no longer
  exists). The real build is `bun run build` (esbuild).
- `scripts/bench.py`, `scripts/bench_remote_setup.py`,
  `scripts/bench_remote_profile.py`, `scripts/BENCH.md` — the "Bazel Build
  Profiling on AWS EC2" harness (spins up EC2, runs `bazel fetch`/build matrix).
  100% Bazel-specific, no callers, no mise/CI wiring.
- `.gitignore` — dropped the "Legacy Bazel marker/lock files" block
  (`.bun-install.lock`, `.bun-install-done`, `.build-*.lock`, `.generate-done` —
  all rules_bun-era markers, produced by no current tooling) and the
  `MODULE.bazel.lock` line (kept the `*.db`/`*.sqlite*` entries it was grouped with).
- Dotfiles (`packages/dotfiles/`): removed `BUILD.bazel` from `.chezmoiignore`,
  the `--glob=!.bazel-*`/`--glob=!bazel-*` rules from `ripgreprc`, and the Bazel
  Spotlight-exclusion lines from `run_once_after_configure-spotlight-exclusions.sh.tmpl`
  (kept the generic `/private/var/tmp` exclusion). Live `~/.config/ripgrep/ripgreprc`
  updated too (chezmoi dual-edit); `chezmoi apply` is a no-op sync for the rest.

**Left intentionally:**

- `packages/docs/archive/bazel/` — the designated home for retired-tech docs
  (per docs discipline; not code).
- Content/fixtures/false-positives: `sjer.red` blog post, `webring` RSS testdata,
  scout arena SVG snapshots (a summoner name), `sandbox/archive/**` (do-not-modify).

**Left as a follow-up (comment-only, deliberately deferred):** four `.ts` files
still _mention_ Bazel in comments explaining still-valid logic —
`scout-for-lol/.../competition.ts` (why `data` doesn't import Prisma — circular
dep), both `discord-plays-*/.../vite-env.d.ts` (fallback type decls), and
`eslint-config/.../no-parent-imports.ts` (the "match LAST /packages/" comment is
actually now better justified by scout's nested `packages/`, not Bazel). These
aren't functional Bazel code, and staging any of them fires heavy per-package
pre-commit hooks (scout runs `db:generate && typecheck && test`; dpp/mk64
typecheck) that would need full `setup.ts --group=scout|pokemon|mk64` — not worth
it for comment text. See PR follow-up.

## Session Log — 2026-07-12

### Done

- Root-caused "buckets keep coming back" to the tofu-managed resources in
  `buckets.tf` (not the setup script). Removed both bucket resources + lifecycle
  blocks, deleted the setup script, updated the tofu README; validated with
  `tofu validate`/`fmt`.
- Repo-wide Bazel sweep: deleted `cooklang/BUILD.bazel`, the `scripts/bench*`
  EC2 profiling harness (4 files), the `.gitignore` Bazel markers, and Bazel
  entries in three dotfiles (+ live `ripgreprc`). Verified no `tools/rules_bun`
  / `.bzl` remained.

### Remaining

- Merge → CI `seaweedfs` apply destroys the buckets. Confirm they're gone
  afterward (`aws s3 ls --profile seaweedfs --endpoint-url https://seaweedfs-s3.tailnet-1a49.ts.net`).
- Optional follow-up: scrub the 4 comment-only Bazel mentions listed above (needs
  scout/pokemon/mk64 setup for their pre-commit hooks).
- `chezmoi apply` to sync the dotfiles changes to live (only `ripgreprc` had a
  live divergence; already synced by hand).

### Caveats

- The bucket destroy is intentional and irreversible for the cached data.
- Bazel-era docs remain under `packages/docs/archive/bazel/` by design.
