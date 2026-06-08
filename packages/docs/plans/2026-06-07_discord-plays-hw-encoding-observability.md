# Discord Plays — VAAPI HW encoding + 16:9 + full observability

## Status

Partially Complete — code shipped & validated locally; cluster-side verification pending deploy.

## Context

Both Discord streaming bots (discord-plays-pokemon, discord-plays-mario-kart) had **choppy**
video and were streaming at the **wrong aspect** (MK pushed out 1280×480 = 8:3, squished).
Investigation: both emulators are software/WASM (no GPU) and ffmpeg used software libx264; only
streambot used VAAPI on the Intel iGPU. The user opted to (a) use VAAPI HW encoding where possible,
(b) emit a 16:9 letterboxed stream, and (c) stand up real observability (metrics, traces,
continuous profiling) to prove where the bottleneck actually is.

Engineering caveat (carried into the dashboard text): at 720p the encoder is cheap and runs off
the JS loop, so VAAPI mainly frees CPU — the likely bottleneck is **single-threaded WASM
emulation** (esp. MK angrylion), which GPU encoding can't speed up. The metrics + eBPF profile
exist to confirm and target the real cause.

## What shipped

| Area      | Change                                                                                                                                                                                                | Files                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork      | opt-in `pad` letterbox on `prepareStream` (software/raw-input path: `scale,pad=…:color=black` before `hwupload`, VAAPI-safe); `isBun/isDeno` made type-safe                                           | `packages/discord-video-stream/src/media/newApi.ts`, `src/utils.ts`                                                                            |
| Bots      | `Encoders.vaapi()` vs software via `hardware_acceleration` config / `STREAM_HARDWARE_ACCELERATION` env; 16:9 1280×720 canvas, game pillarboxed (`computeLetterbox`, MK 4:3→960×720, GBA 3:2→1080×720) | both `…/stream/game-streamer.ts`, `stream/letterbox.ts`(+test), `config/schema.ts`, `emulator/constants.ts`, `index.ts`, `config.example.toml` |
| Images    | shared `withDiscordPlaysRuntime` adds ffmpeg+libvips+libva+amd64 `intel-media-va-driver-non-free`                                                                                                     | `.dagger/src/image.ts`, both `Dockerfile`                                                                                                      |
| Metrics   | `prom-client` `/metrics`: emulate/copy/late histograms, ticks+resync counters, sink-buffer+stream-active gauges, default process/event-loop-lag                                                       | both `…/observability/metrics.ts`, `webserver/express.ts`, emulator hot loops                                                                  |
| Traces    | OTLP→Tempo lifecycle spans gated by `TELEMETRY_ENABLED`                                                                                                                                               | both `…/observability/tracing.ts`, `index.ts`, `game-streamer.ts`                                                                              |
| Homelab   | i915 request + VAAPI/telemetry env + ServiceMonitor on both deployments; pokemon resources block; mario-kart added to GPU patch list                                                                  | `homelab/.../resources/{pokemon,mario-kart}.ts`, `scripts/patch.ts`                                                                            |
| Profiling | Grafana Pyroscope app + privileged Alloy eBPF DaemonSet + Grafana datasource                                                                                                                          | `homelab/.../argo-applications/{pyroscope,alloy}.ts`, `apps.ts`, `grafana-values.ts`, `versions.ts`                                            |
| Dashboard | "Discord Plays — Stream Health" (fps, emulate/copy/late p95, sink buffer, event-loop lag)                                                                                                             | `homelab/.../grafana/discord-plays-dashboard.ts`, `resources/grafana/index.ts`                                                                 |

## Verification done

- ffmpeg `scale,pad` chain renders valid 1280×720 pillarboxed output (synthetic frames; PNGs).
- pokemon Dagger image (with VAAPI apt) builds + boots (smoke test: expected auth failure).
- `prom-client` incl. default + event-loop-lag metrics serialize under Bun; `/metrics` lint-clean.
- typecheck + tests + eslint green: fork, both bot backends, homelab cdk8s (131 pass); cdk8s synths.

## Remaining / cluster verification (post-deploy)

- Confirm ffmpeg actually uses `h264_vaapi` in-cluster (`vainfo`, encoder log) and falls back to
  software where no GPU.
- Join the Discord stream: confirm 16:9 pillarbox, un-squished, smooth.
- Grafana: confirm the dashboard populates and `stream_sink_buffer_bytes` stays flat; confirm
  traces land in Tempo and Pyroscope flame graphs render (validate the **Alloy eBPF River config**
  — privileged DaemonSet, written to Grafana's documented pattern but unverified at runtime).
- Use the profile/metrics to decide the real fps fix (likely emulation-side: pokemon renders ~60
  but streams 30 → render every other frame; MK angrylion → lower res/scale or worker thread).
- Image version bump in `versions.ts` is CI-managed (version-commit-back) after merge.

<!-- temporal-agent-task omitted: no standing future obligation with a concrete date. -->
