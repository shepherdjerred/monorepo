# CI Disk Write Reduction — Bake `setup-tools.sh` Installs Into `ci-base`

## Status

**Implemented** — `ci-base:406` deployed to all CI pods 2026-05-10. Impact analysis pending T+24h and T+7d data.

## Context

`nvme0n1` on `torvalds` was hitting **400–800 MB/s sustained** during CI bursts and thermally throttling at **75 °C** (Samsung 990 PRO operating max = 70 °C). Running CI on consumer NVMe with cold per-pod tool installs was the root cause.

## What was measured (investigation findings)

### Per-pod overlay attribution (pre-fix `:404`)

Direct `du` on a real Buildkite Job pod's `container-0` overlay upperdir (`/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/<id>/fs/`):

| Path | Size | What |
| --- | --- | --- |
| `/root/.local/share/uv` | **447 MB** | `uv tool install semgrep` venv |
| `/root/.cache/uv/archive-v0` | **362 MB** | `uv` download cache |
| `/usr/lib/x86_64-linux-gnu` + `/usr/libexec/gcc` | **237 MB** | apt-installed gcc/g++/libs |
| `/var/cache/apt/archives` | **92 MB** | apt downloaded `.deb` files (never cleaned) |
| `/workspace` (emptyDir) | **779 MB** | git clone of monorepo |
| **Total per pod** | **~2.0 GB** | All on `nvme0n1` (xfs at `/var`) |

### Process-tree confirmation

`iotop`/cgroup attribution caught the exact command running mid-burst:

```
apt-get install -y -qq curl jq git ca-certificates unzip gcc g++ python3 libssl-dev pkg-config
/usr/bin/dpkg --status-fd 15 --no-triggers --unpack ...
```

Byte-for-byte match to `install_base()` in `.buildkite/scripts/setup-tools.sh:46`.

### Why this scaled catastrophically

- ~25–30 concurrent buildkite pods at peak Kueue admission
- Each pod ran the same `setup-tools.sh` runtime installs
- `60–100+ GB written per CI wave` to `nvme0n1`, all to per-pod overlay upper layers (NOT shared)

## The fix

Bake every tool that `setup-tools.sh` installs into `ci-base` so each `install_X()` short-circuits via `command -v X && return`:

| Tier | Tools |
| --- | --- |
| 1 | `gcc g++ python3 libssl-dev pkg-config` (apt) + `semgrep` via `uv tool install` |
| 2 | `gh`, `helm`, `opentofu`, `awscli`, `ripgrep`, `shellcheck`, `gitleaks`, `trivy` |
| Skipped | Rust toolchain (~2 GB; only 2 step types use it; consider separate `ci-rust` variant later) |

`setup-tools.sh` was NOT modified — the existing `command -v` guards handle the no-op transparently.

## Files changed

| File | Change | PR |
| --- | --- | --- |
| `.buildkite/ci-image/Dockerfile` | +82 lines: 11 tool installs + 12 ARGs with `# renovate:` comments | #757 |
| `.buildkite/ci-image/Dockerfile` | + `gnupg` to apt install (required by opentofu installer for signature verification) | #760 |
| `.buildkite/ci-image/VERSION` | `404` → `406` | #757, #759 |
| `.buildkite/pipeline.yml` line 16 | bootstrap `ci-base:404` → `ci-base:406` | #762 |
| `.dagger/src/image.ts:771` | `dockerBuild()` → `dockerBuild({ platform: "linux/amd64" })` | #759 |

## Verification — local proof

`docker run --rm ghcr.io/shepherdjerred/ci-base:406 bash -c 'source setup-tools.sh; for fn in install_base install_semgrep install_gh ...; do $fn; done'` — every function reports `"already installed, skipping"` with zero overlay writes.

## Verification — cluster proof

Direct `du` on a running `:406` pod's `container-0` upperdir:

| Path | Pre-fix (`:404`) | Post-fix (`:406`) |
| --- | --- | --- |
| `/var/cache/apt/archives` | 92 MB | **0 MB** ✓ |
| `/usr/libexec/gcc` | 100 MB | **0 MB** ✓ |
| `/usr/lib/x86_64-linux-gnu` | 85 MB | **0 MB** ✓ |
| `/root/.local/share/uv` | 447 MB | **0 MB** ✓ |
| `/root/.cache/uv` | 388 MB | **0 MB** ✓ |
| **TOTAL container-0 overlay** | **~1,200 MB** | **24 MB** |

The 24 MB residual is `~/.bun/install/cache` (bun install cache being warmed during job work — separate Dagger cache mount, unrelated to setup-tools.sh).

## Impact analysis plan

### Baseline snapshot — 2026-05-10 20:51 PDT (post-fix start)

| Metric | nvme0n1 | nvme1n1 |
| --- | --- | --- |
| Lifetime writes (NVMe `nvme_data_units_written_total`) | **185.83 TB** | **175.81 TB** |
| SMART wear (`nvme_percentage_used_ratio`) | 8% | 14% |
| Current temp | 51 °C | 49 °C |
| 30d avg write rate (pre-fix baseline) | **8.0 MB/s** | **15.2 MB/s** |
| 7d avg write rate (pre-fix baseline) | 11.8 MB/s | 34.6 MB/s |
| 7d peak burst (pre-fix baseline) | 542 MB/s | 584 MB/s |
| 1h peak temp (transition noise) | 74 °C | 52 °C |

### T+24h check (one full diurnal cycle on `:406`)

Re-run:

```bash
toolkit grafana query 'nvme_data_units_written_total' --instant
```

Compute Δ across 24h to get post-fix average bytes/sec. Compare to 30d-pre baseline.

**Headline metric**: % reduction in nvme0n1 daily MB/s.

### T+7d check (one full week of normal CI cadence)

Same comparison over a 7d window. Expected:

- nvme0n1 7d-avg: ~12 MB/s → ~3-6 MB/s (50-70% reduction)
- nvme1n1 7d-avg: ~35 MB/s → ~10-15 MB/s
- nvme0n1 peak burst: ~540 MB/s → ~150-250 MB/s
- nvme0n1 burst peak temp: 75 °C → ≤65 °C (no thermal throttle)

### Per-burst capture (next CI wave)

Re-deploy a privileged trace pod in `dagger` ns with `host:/` mounted; for a sample of 5 random `:406` pods, `du` their `container-0` upperdir. Confirm `/var/cache/apt/archives` + `/usr/libexec/gcc` + `/root/.local/share/uv` + `/root/.cache/uv` are all 0 (already verified once for one pod; widening sample increases confidence).

## Trade-offs accepted

- **Image size**: ~600 MB → ~840 MB compressed. One-time pull cost per node (Talos `/var` has 4 TB). The cold pull spikes `nvme0n1` writes once per image version per node, then amortizes.
- **Renovate sync**: tool versions in Dockerfile must stay aligned with `setup-tools.sh` constants. Mitigated by Renovate `# renovate:` comments matching the existing pattern in `setup-tools.sh`.

## Out of scope

- **Active heatsink fan on nvme0n1** — separate hardware action; this PR reduces the trigger but doesn't change thermal margin
- **`emptyDir.medium: Memory` for `/workspace`** — only matters if the per-pod ~780 MB git clone becomes the next-biggest writer
- **Per-package Dagger call consolidation** — irrelevant to nvme0n1 (Dagger writes go to nvme1n1)
- **Rust toolchain bake** (Tier 3) — adds ~2 GB; deferred unless rust pods become a hot spot
- **`setup-tools.sh` body cleanup** — functions are inert once tools are in `$PATH`; housekeeping for a future PR

## Lessons learned (from the rocky rollout)

1. **Specify `platform` in `dockerBuild()` explicitly.** PR #757's `:405` was built as arm64 instead of amd64 because `Container.dockerBuild()` defaulted to whatever the buildkit reported. Fix in PR #759 added `platform: "linux/amd64"`.
2. **Test the Dockerfile builds end-to-end before merging.** The opentofu installer requires `gpg`/`cosign`; the `oven/bun:debian` base has neither. The Buildkite-driven `:406` build also failed silently because of this. Fix in PR #760 added `gnupg`. Caught only after manually rebuilding from my workstation.
3. **Bootstrap reference is a separate concern from `VERSION`.** The bootstrap `pipeline.yml:16` is read literally; it must point to a known-working image. The rest of CI reads VERSION at pipeline-gen time. PR #759 reverted bootstrap to `:404` for safety; PR #762 bumped it to `:406` after `:406` was verified working.
4. **The Kueue + Buildkite combination can deadlock.** When all admitted workloads are stuck in `ImagePullBackOff` for a missing image, no new workloads (including the build that would create the image) can be admitted. Required manual recovery: build/push the image from my workstation to break the loop.

## Session Log — 2026-05-10

### Done

- Investigation: identified per-pod overlay churn from runtime tool installs as root cause of nvme0n1 thermal throttling
- Direct cgroup-level attribution proved `setup-tools.sh`'s `install_base` + `install_semgrep` were the dominant writers
- PR #757 baked Tier 1 + Tier 2 tools into `ci-base:405` — produced wrong-arch image
- PR #759 pinned `linux/amd64` + bumped to `:406` — Buildkite build failed silently due to missing `gnupg`
- Manually built + pushed `:406` from workstation to break Kueue deadlock
- PR #760 added `gnupg` permanently
- PR #762 bumped pipeline.yml bootstrap to `:406` so the slow apt-install `Generate Pipeline` step is also fixed
- Cluster verification: `du` on a real `:406` pod's container-0 upperdir = 24 MB (vs ~1,200 MB on `:404`)
- Local verification: every `install_X()` in `setup-tools.sh` no-ops via `command -v` guard when run in `:406`
- Baseline snapshot recorded for impact analysis

### Remaining

- T+24h: re-snapshot `nvme_data_units_written_total`, compute post-fix daily write rate
- T+7d: same over 7d window; record peak burst rate + peak temp under burst
- Per-burst sample: trace pod du across 5 `:406` pods to widen the confidence on the 24 MB/pod number
- Optional: investigate the lockfile-frozen and `claude --dangerously-skip-permissions` test failures observed during the rollout (both appear pre-existing, not caused by the bake)

### Caveats

- The 1h write rate at the post-fix baseline (180 MB/s on nvme0n1) is dominated by this session's chaos (image builds, pulls, deadlock recovery) and is NOT representative of post-fix steady state. Use 30d/7d windows or T+24h re-snapshot for the real comparison.
- The peak-temp 1h reading of 74 °C is from pre-fix bursts within the 1h window (the bursts happened before `:406` rolled out).
- The `:406` image is amd64-only. If we ever spin up an arm64 node, ci-base will need a multi-arch manifest.
- `setup-tools.sh` still has the install function bodies. Future cleanup PR can remove them; until then they're inert (no-op via `command -v` guards).
