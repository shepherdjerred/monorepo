# Streambot: full-GPU VAAPI pipeline (fix 4K stutter)

## Status

Complete (shipped in PR #1085; pending CI image build + ArgoCD deploy + post-deploy verification).

## Context

Playback stuttered on large local files (`Inception` — **80 GB, HEVC 3840×2160**). Logs showed repeated `Frame takes too long to send` (130–440% of frametime). Confirmed live on `torvalds`: the pod was **CPU-throttled 72.6%** of scheduling periods against its 2-core limit. Cause: the streaming library decoded into system RAM (`-hwaccel auto`) and **scaled 4K→1080p in software** (swscale); only the H.264 encode ran on the iGPU.

Node benchmark (30 s of content, `-f null`): software scale = **55.2 s CPU, 0.77× realtime** (sub-realtime even unthrottled, ~1.4 cores — so a CPU-limit bump alone would not fix it); full VAAPI = **2.5 s CPU, 5.7× realtime** (~22× less CPU). Disk I/O not a factor (~48 MB/s read at 5× realtime).

## Change

`packages/discord-video-stream` (in-repo fork; consumed by streambot as TS source via `file:`):

- `src/media/encoders/index.ts` — new optional `EncoderSettings.hwPipeline` = `{ decodeOptions, scaleFilter(w,h) }`.
- `src/media/encoders/vaapi.ts` — declare `hwPipeline` (`-hwaccel vaapi -hwaccel_output_format vaapi -hwaccel_device`, `scale_vaapi=w:h:format=nv12`) + pin `options: ["-rc_mode","VBR"]` (default AVBR ignores `-maxrate`/`-bufsize` → uncapped bitrate). Kept `outFilters` for the no-hw-decode path.
- `src/media/newApi.ts` — resolve the encoder up front; when `hwPipeline` is active + hw decode enabled, use GPU decode options + `scale_vaapi` and skip the software `scale`, `-pix_fmt yuv420p`, and `hwupload` outFilters.
- `test/encoders-vaapi.test.ts` — assert the VAAPI pipeline declaration (decode flags, scale filter, VBR, device threading).

No `streambot`/homelab changes: `streamer.ts` already passes `Encoders.vaapi()` + explicit 1080p dims. Software/nvenc paths untouched (no `hwPipeline`).

## Verification

- Fork `bun run typecheck` ✅, `bun test` ✅ (10 pass, incl. 3 new).
- Live-validated on the node: resulting command (with audio + `-ss` seek + VBR) runs 5.4× realtime, ~0.68 cores, no errors, VBR honored.
- Post-deploy: play Inception, confirm `cpu.stat nr_throttled` flat, `kubectl top pod` < 1 core, ffmpeg cmdline shows `scale_vaapi`/`-hwaccel vaapi`, logs free of `Frame takes too long to send`; verify `/stream seek`.

## Session Log — 2026-06-07

### Done

- Diagnosed live (kubectl): 72.6% CFS throttling; software 4K swscale at 144% CPU in ffmpeg.
- Benchmarked software vs full-VAAPI pipeline on the node against the real 80 GB 4K remux.
- Implemented `hwPipeline` abstraction + VAAPI full-GPU pipeline + VBR; added unit tests.
- Based on `main` (fork landed there); shipped as PR #1085.

### Remaining

- Merge → CI image build → `versions.ts` commit-back → ArgoCD deploy.
- Post-deploy verification (above), ideally while playing the 4K Inception remux.

### Caveats

- The fork's `tsconfig` is standalone/lenient by design; streambot's strict tsconfig surfaces pre-existing strict-mode errors in fork `src` only in fresh worktrees where the fork resolves to source rather than built `dist` — unrelated to this change.
- `scale_vaapi` needs explicit dims; streambot always passes 1920×1080, so the library's negative-dim default never reaches the hw path.
