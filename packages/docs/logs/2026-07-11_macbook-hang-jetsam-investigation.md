# 2026-07-11 — MacBook hang investigation (jetsam / memory-pressure freezes)

## Status

Complete (investigation); remediation not yet applied.

## Symptom

Recurring whole-machine hangs on Jerred's MacBook Pro (M5 Pro, 64 GB, macOS 27.0 beta 26A5368g); only recovery is a hard reboot. Reboots on Jul 5 (23:41), Jul 6 (17:54, 22:08), Jul 9 (22:25), Jul 11 (12:12).

## Evidence

No kernel panics, no ShutdownStall/spindump/watchdog reports. The hangs are **memory-pressure livelocks**, recorded as `JetsamEvent-*.ips` in `/Library/Logs/DiagnosticReports/Retired/` (32 files since Jul 1; ~19 are genuine pressure events with free RAM < 1 GB, the rest are benign `long-idle-exit` housekeeping kills).

Each user-visible hang lines up with a jetsam event minutes before the reboot:

| Hang/reboot  | Jetsam event | Free RAM | Compressor | Trigger                           |
| ------------ | ------------ | -------- | ---------- | --------------------------------- |
| Jul 5 23:41  | 23:32        | 39 MB    | 27 GB      | fork-storm                        |
| Jul 6 17:54  | 17:49        | 114 MB   | 21 GB      | fork-storm                        |
| Jul 9 22:25  | 20:48        | 444 MB   | 28 GB      | OrbStack 25 GB                    |
| Jul 11 12:12 | 11:41        | 101 MB   | 4 GB       | aggregate (git 5.9 GB + baseline) |

### Methodology note (important for future analysis)

Naively summing jetsam `rpages` massively over-counts: it double-counts shared pages across forks and includes file-backed mmaps (git processes "using 16 GB" were actually mmapping pack files — reclaimable page cache). Use `physicalPages.internal` (`[0]` ≈ dirty/anon-resident, `[1]` ≈ the rest); `coalition` IDs reconstruct ancestry.

## Root causes (three distinct, all ending in the same freeze)

1. **Fork-storm (worst freezes, Jul 5 23:32 & Jul 6 17:49).** A single coalition led by ghostty (i.e. terminal/claude sessions) contained **6,042–6,772 processes**: `env×3378-4108, bash×1550-1662, bun×773-798, node×198-316`. All spawned within seconds (age ≈ 0), interleaved `env→bash→bun→node` chains — a massively parallel monorepo fan-out. Each `node` (tsc/eslint-shaped, ~100–160 MB private, ~0.9 s CPU = just booted) × 316 ≈ **21–31 GB of anonymous memory materializing in seconds**. Signature matches several concurrent agents each running root-level `bun run typecheck`/`build` (35 packages × node tool × N agents). Notably _not_ Claude Code's Bash tool (that wraps in zsh; only 7 zsh procs present).
2. **Concurrent git on 27 worktrees.** 15–17 simultaneous `git` processes holding **5.9–18.7 GB anonymous** memory (plus `watchman` 1–1.6 GB, `git fsmonitor--daemon`, `core.untrackedcache`). 27 worktrees each with full node_modules make every parallel `git status`/diff enumeration expensive, and multiple agent sessions run them concurrently.
3. **OrbStack balloon (Jul 9 20:48).** OrbStack Helper at **25 GB private** + compressor 28 GB. Its 56 GiB "limit" on a 64 GB machine is effectively no limit. In steady state it sits at 2–4.5 GB.

**Baseline is also chronically high**: 5 concurrent claude sessions (~0.5–0.7 GB each), toolkit recall watch (~0.9 GB), Safari WebContent (2–4 GB), Apple Intelligence (TGOnDeviceInference ~1 GB), watchman, plus 20–35 GB file cache from monorepo I/O. Steady-state anonymous memory runs 24–37 GB before any spike.

No swapfile existed at any point (`/System/Volumes/VM` has no swapfile; `vm.compressor.segment.swappedout=0`), so pressure escalates compressor → livelock → jetsam with no disk-swap cushion. Not obviously misconfigured (no boot-args) — possibly macOS 27 beta behavior worth watching.

## Recommendations (not yet applied)

1. **Prune worktrees** — 27 exist, many stale (`git worktree list`); each costs disk (~13–15 GB deps), watchman/fsmonitor load, and git-status memory. Remove merged ones per CLAUDE.md workflow.
2. **Avoid N concurrent full-repo verifications** — agents should scope checks (`--filter='./packages/<x>'`, `--group=`) instead of root `bun run typecheck`/`build`; multiple simultaneous root fan-outs are the fork-storm.
3. **Lower OrbStack memory limit** to ~16–24 GiB (Settings → System → Memory limit; currently 56 GiB).
4. Optionally cap concurrent claude sessions / background daemons when doing heavy multi-agent work; consider whether `core.untrackedcache` + fsmonitor across all worktrees is worth the memory.
5. Re-check after a week: `ls /Library/Logs/DiagnosticReports/Retired/ | grep Jetsam` — success = no new events with free < 1 GB.

## Session Log — 2026-07-11

### Done

- Located the hangs: jetsam memory-pressure events, timeline-matched to each reboot (table above).
- Attributed all three distinct causes (fork-storm, concurrent git across 27 worktrees, OrbStack balloon) with corrected accounting (private pages, coalition ancestry, spawn-age histograms).
- Ruled out: kernel panics, WindowServer stalls, MCP stdio respawn loops (all servers are SSE), Claude Bash tool (zsh, not bash), single "50 GB node leak" and "16 GB git leak" (both rpages artifacts).

### Remaining

- Remediation status: **#1 worktree prune** — already handled by the user's existing scheduled prune (no action). **#2 scoped verification** — guidance shipped alongside this log (root `AGENTS.md` Verification + Commands sections; `worktree-workflow` and `bun-workspaces` skills, chezmoi source + live copies dual-edited). **#3 OrbStack cap** — user's call; still 56 GiB.
- Watch for recurrence; if jetsam events persist with free < 1 GB after remediation, investigate the ~7 GB of anonymous memory not attributed to any listed process (likely IOSurface/kernel) and the no-swapfile behavior on the macOS 27 beta.

### Caveats

- macOS 27.0 is a beta; jetsam record field semantics (`physicalPages.internal[0]/[1]`, `age` units) were inferred empirically, not from documentation.
- The fork-storm attribution to concurrent agent fan-outs is strong circumstantial (coalition, process mix, timing vs session logs) but no argv survives in jetsam records to prove which script spawned it.
