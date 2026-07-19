---
id: guide-2026-06-14-streambot-autonomous-perf-debug-runbook
type: guide
status: complete
board: false
---

# Streambot autonomous perf-debug runbook

## Why this works for streambot

The cluster is **single-node** (torvalds, see `[[reference_homelab_single_node]]`), so there's no placement variance and "deploy" == "replace prod". Streambot already emits the metrics needed to judge "is ffmpeg keeping up" without a human watching the stream (`streambot_ffmpeg_fps`, `_speed_ratio`, `_send_late_frames_total`, eventloop lag, heap, plus per-process `drm-engine-*` from sysfs). And the dvs library lives in-repo (`packages/discord-video-stream/`), so encoder code is editable from the same checkout that builds the image.

## Capability matrix (verified 2026-06-14)

| Need                          | Tool                                 | Notes                                                                                                           |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Drive the bot (play/seek/etc) | `toolkit discord slash`              | userbot invokes streambot's slash commands                                                                      |
| Sit in VC as the audience     | `toolkit discord voice join`         | userbot presence persists for the session                                                                       |
| Observe VC state              | `toolkit discord voice states`       | streaming flags per identity                                                                                    |
| Metrics                       | `toolkit grafana query <PromQL>`     | `streambot_*` series + cgroup CPU/mem; dashboard in `packages/homelab/src/cdk8s/grafana/streambot-dashboard.ts` |
| Logs                          | `toolkit grafana logs <LogQL>`       | Loki; ffmpeg stderr is captured                                                                                 |
| Pod state                     | `kubectl -n media …`                 | write perms verified (patch deployments, delete pods, set image)                                                |
| Build + push image            | `dagger` + `docker push ghcr.io/…`   | docker already authed as `shepherdjerred`; `smoke-test-streambot` Dagger fn exists                              |
| Edit encoder                  | `packages/discord-video-stream/src/` | in-repo, not a vendored submodule                                                                               |
| Repro local                   | `e-2-e-streambot` Dagger fn          | uses test-server IDs from `[[project_streambot_e2e_test_server]]`; tokens in 1P `streambot-config`              |

## The debugging loop

1. **Read symptoms.** PromQL/LogQL the panels in `streambot-dashboard.ts`. Get a quantitative target (e.g. `ffmpeg_speed_ratio` should sit at 1.0, current is 2.4–3.4×).
2. **Hypothesize from metrics + code.** Read the relevant source path (`packages/streambot/src/streamer/`, `packages/discord-video-stream/src/`). No human needed.
3. **Patch in-repo.** Edit `discord-video-stream` or `streambot` source on a worktree branch.
4. **Build + push a one-shot image.**

   ```bash
   docker buildx build --platform linux/amd64 \
     -t ghcr.io/shepherdjerred/streambot:debug-<slug>-<short-sha> \
     -f packages/streambot/Dockerfile --push .
   ```

5. **Deploy to prod (Argo paused).**

   ```bash
   kubectl -n argocd patch app media-streambot --type=merge \
     -p '{"spec":{"syncPolicy":{"automated":null}}}'
   kubectl -n media set image deploy/media-streambot \
     streambot=ghcr.io/shepherdjerred/streambot:debug-<slug>-<short-sha>
   kubectl -n media rollout status deploy/media-streambot
   ```

6. **Drive a session, then soak.** Userbot joins the test VC; invoke `/stream play <known-bad-source>` via `toolkit discord slash`. **Real bugs here take 5–15 minutes to manifest** (buffer-growth → GC pause, slow leaks, jitter-buffer build-up). Anything sooner than ~10 min of steady-state playback is not a verdict — it's still cold-start. Plan on **≥20 min per iteration** end-to-end (15 min soak + ~5 min build/push/deploy/handoff). Don't quit early on a clean 2-minute sample.
7. **Score.** Run the same PromQL from step 1 over the **last 10 min of soak only** (slice off the warmup), diff against pre-change baseline. Watch slope, not instantaneous value, for leaky-buffer / heap-growth bugs. Decide: better / no-change / worse. Loop or stop.
8. **Land or roll back.**
   - **Win** → move the image tag bump into `packages/homelab/src/cdk8s/src/resources/streambot.ts` (`versions.ts` if pinned there), open a PR with the dashboard screenshots, re-enable Argo automation.
   - **Bust** → unpause Argo; it'll self-restore the prod tag.

## Quantitative health checks (use as exit conditions)

| Metric                                                | Healthy target         | Source                              |
| ----------------------------------------------------- | ---------------------- | ----------------------------------- |
| `rate(streambot_ffmpeg_fps[1m])` vs configured target | within 5%              | matches "ffmpeg keeping up"         |
| `streambot_ffmpeg_speed_ratio`                        | ~1.0 sustained         | >1.5 = unbounded buffering risk     |
| `streambot_nodejs_eventloop_lag_p99_seconds`          | < 50 ms                | GC pauses → viewer freezes          |
| `streambot_nodejs_heap_size_used_bytes` slope         | flat after warmup      | growth slope = leak signature       |
| `rate(streambot_send_late_frames_total[5m])`          | ~0                     | per-frame outlier counter           |
| `streambot_hw_fallback_total`                         | 0                      | VAAPI engaged, no software fallback |
| `/proc/<ffmpeg-pid>/fdinfo/3 drm-engine-video`        | accumulating wall-time | GPU silicon actually doing the work |
| `kubectl top pod` CPU                                 | nowhere near the limit | rule out CFS throttling             |
| `kube_pod_container_status_restarts_total`            | 0 over the session     | sanity                              |

## What I need from the user

| Ask                                                                                                                      | When           | Why                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------ |
| Approval to pause Argo on `media-streambot` for the session                                                              | once, up front | otherwise every `kubectl set image` is reverted within seconds           |
| One batched `op item get streambot-config` to dump test-server tokens                                                    | once, up front | each `op` call needs manual approval; batching keeps the loop autonomous |
| Confirmation that the test Discord server (per `[[project_streambot_e2e_test_server]]`) is fair game for active sessions | once, up front | userbot will join VC and play media there for minutes at a time          |
| Sign-off on the PR when the fix lands                                                                                    | at the end     | normal review; agent won't self-merge                                    |

**That's the entire human-in-the-loop surface.** Everything between step 1 and step 8 — observe, hypothesize, patch, build, push, deploy, drive, score — is autonomous.

**Wall-clock budget.** Each iteration is ≥20 min because the failure modes here take 5–15 min to surface (step 6). A debug session is realistically **3–4 iterations per hour, not 8–10**. Plan the session length accordingly; don't expect a one-hour turnaround on a non-trivial regression.

## Caveats

- **Don't forget to unpause Argo at session end** (`kubectl -n argocd patch app media-streambot --type=merge -p '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true}}}}'`) — leaving it paused means a future cdk8s change won't reconcile.
- **`debug-*` image tags are throwaway** — don't land them in cdk8s. Cut a real semver tag (or let Renovate/CI do it) before PR.
- **Single-node means the session IS prod.** A wedged debug image takes the real bot down. Unpause Argo to recover instantly.
- **Userbot ToS surface area.** Drive automation through `/stream …` slash commands (which the command bot legitimately exposes), not through raw selfbot APIs.
- **Subjective "looks bad" is still a gap.** This runbook chases quantifiable regressions. If a user reports something the metrics don't see, add a metric first (`[[feedback_extend_before_invent]]`) — don't trust eyeballs.
- **No early-exit heuristics.** Don't try to score in the first 5 min "to save time" — the bug shape (rate-mismatch buffer growth, GC pause cadence) only emerges after the buffer fills. A green 3-min sample is meaningless; a red 3-min sample is real but probably means something worse than what's being chased.

## Session Log — 2026-06-14

### Done

- Saved this runbook (`packages/docs/guides/2026-06-14_streambot-autonomous-perf-debug-runbook.md`).
- Saved single-node fact to auto-memory (`reference_homelab_single_node.md`).
- Verified capability matrix end-to-end against the live tree (kubectl perms, docker ghcr auth, toolkit discord daemon, toolkit grafana, dagger, streambot package layout).

### Remaining

- No code change requested this session. When the user kicks off a real debug session, the three "What I need from the user" items are the entry checklist.

### Caveats

- Companion plan `2026-06-14_streambot-stutter-rate-mismatch.md` is `In Progress` (PR #1196 open) — that's a specific instance of the loop already running; don't re-do its work.
- This doc says nothing about CI for debug images — they intentionally bypass CI (direct `docker push`) because they're throwaway. The eventual fix PR goes through normal CI.
