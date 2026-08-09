---
id: plan-2026-08-08-mk64-driver-feed
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# MK64 driver feed — in-browser video for players, Go-Live for spectators

## Context

`packages/discord-plays-mario-kart` streams headless MK64 into a Discord voice
channel as a Go-Live broadcast, while up to four players drive from a
**controls-only** web page at `mariokart.sjer.red`. That page had no `<video>`,
no `<canvas>`, and no frame path at all: players watched Discord in one window
and drove from another.

[`2026-08-03_mk64-latency-full-surface.md`](2026-08-03_mk64-latency-full-surface.md)
measured felt latency at ~210–360 ms and identified the Discord client's playout
buffer as the largest remaining term (~85 ms de-jitter plus a 35–80 ms Discord
leg that tails past 170 ms). Phase 1 of that plan already took the cheap
server-side wins (−54.5 ms glass-to-glass, 95% CI [−63, −47]). What remains on
the Discord path is not ours to fix — the same document records a between-session
client-state range of ~68–370 ms, 5–7× the effect size of every server-side tweak
combined.

**This adds a second video path rather than replacing the first.** Spectators
keep the Go-Live stream byte-for-byte as it was. Drivers additionally receive
H.264 access units over a WebSocket and decode them in the controller page,
skipping Discord's voice pipeline entirely.

### Why not a Discord Activity

Explored first and rejected on two independent grounds:

- **Distribution.** Discord's own documentation (support-dev article
  26576097154199, updated 2026-06-23) states unverified Activities are "limited
  to servers with fewer than 25 members" and playable only by dev-team members
  (≤100, who must be the owner's Discord friends) or App Testers (≤50).
  Verification lifts the cap but requires Stripe identity verification, publicly
  hosted ToS and privacy policy, App Directory content review, and permanently
  forces the bot public — not a review an MK64 ROM emulator should enter.
- **Latency.** Activities permit only WebSocket/HTTPS through Discord's
  Cloudflare Workers proxy; WebRTC and WebTransport are explicitly blocked. That
  is strictly worse than talking to our own origin directly.

WebRTC to the existing web app was also considered. The homelab can do it — there
is proven public UDP ingress (`nodeport-addresses: 0.0.0.0/0` in the Talos config,
UDP NodePort 30003 serving Minecraft Bedrock) — but it needs a new NodePort, a
router forward, and a story for the dynamic WAN IP, since ICE candidates are
addresses rather than names. WebSocket over the existing Cloudflare tunnel needs
none of that, and remains the upgrade path if TCP head-of-line blocking proves
to matter in practice.

## Measured latency

Two independent measurements on the same machine (Apple silicon, **libx264**, ROM
via `--rom`, loopback), which is the number that answers "is this actually
faster":

| Leg                                 | p50   | p95   | Method                                                                                         |
| ----------------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------- |
| Capture → encoded access unit ready | 34 ms | 36 ms | HUD clock decoded from each AU, differenced against the same process clock (`e2e:driver-feed`) |
| Capture → painted on canvas         | 36 ms | 64 ms | the shipped client's own readout, sampled from a real Chrome tab (`e2e:driver-feed:glass`)     |

Three things follow.

**The browser is nearly free.** Two methods that share no code agree the encode
leg is ~34 ms, and the full glass figure is only ~2 ms more at p50 — WebSocket
delivery plus WebCodecs decode plus paint cost almost nothing on loopback.

**The pipeline is pacing-bound, not compute-bound.** 34 ms is one frame interval
at 30 fps (33.3 ms). Re-running the encoder at the Go-Live path's output size and
bitrate (960x720 @ 5 Mbps, `--golive-profile`) produced an _identical_ 34/36 ms.
So the 640x480 default does not buy latency — it buys bandwidth (2.4 vs
4.8 Mbps). Anything below ~34 ms would require attacking the frame pacing itself.

**Against the Discord path.** The driver feed removes four legs that
[`2026-08-03_mk64-in-discord-latency-burn-down.md`](2026-08-03_mk64-in-discord-latency-burn-down.md)
budgets at 45–90 (encode) + 16–40 (pacing) + 35–80 (Discord leg, 170+ tail) + ~85
(client de-jitter) ≈ **180–295 ms**, and replaces them with a measured 36 ms.
Every other term — browser input ~6 ms, backend latch ~9.5 ms, the game's own
~58 ms reaction, the player's display — is untouched by this work. That puts
press-to-glass at roughly **125–150 ms on a LAN against the burn-down doc's
210–360 ms**, plus real network RTT for a remote player.

Caveats, stated plainly: this is loopback, so a driver on the internet adds tunnel
RTT; it is libx264 on a laptop rather than VAAPI on the pod (though the
resolution A/B suggests encode compute is not the binding constraint); and the
Go-Live figures are the burn-down doc's pod measurements, not a same-box A/B of
both full paths. The tail should also improve more than the median suggests,
because there is no adaptive playout buffer to inflate.

## Measured correctness

The pipeline is verified end-to-end by `bun run e2e:driver-feed` (synthetic
frames, real ffmpeg, no ROM required):

| Property                         | Result                              |
| -------------------------------- | ----------------------------------- |
| Access units from 90 frames      | 88 (2 in flight at teardown)        |
| Decoder entry points             | 3, matching the 30-frame GOP        |
| Full stream re-decoded           | 88 frames, zero decoder errors      |
| Late join at the 2nd entry point | exactly the remaining 58 frames     |
| Observed bitrate                 | ~1.8 Mbps against a 2.5 Mbps target |

The late-join decode is the load-bearing one: it proves a client can cold-start
at any entry point, which is the property the hub's fan-out rule depends on. It
is validated against ffmpeg's decoder rather than against our own parser, since
the parser is the thing under test.

### Self-measuring latency

Because the tee sits after the overlay, the pixels the browser paints carry the
UTC instant the emulator produced them. The controller page decodes that clock
back off its own canvas four times a second and displays capture-to-paint
latency directly — no extra protocol, no server cooperation, no estimation.

The font and the decoder both live in `packages/common`, so the renderer and the
reader cannot drift; `src/stream/hud-clock-roundtrip.test.ts` draws with the
production renderer and decodes with the production decoder, including at
non-integer output scales. Two honest caveats, stated in the UI tooltip: it
compares the server's clock to the browser's (meaningful only when both are
NTP-synced), and it excludes the display's own pipeline.

## Architecture

```
                                    ┌── applyStreamOverlays (in place, existing)
emulator.onFrame(BGRA 640x240) ─────┤
                                    ├─→ streamer.pushFrame()  → ffmpeg #1 → NUT → Go-Live   [UNCHANGED]
                                    └─→ driverFeed.pushFrame() → ffmpeg #2 → Annex-B H.264
                                                                      ↓
                                                        AnnexBSplitter (AUD-delimited)
                                                                      ↓
                                                    DriverFeedHub → WS /video (binary)
                                                                      ↓
                                              VideoDecoder → VideoFrame → canvas
```

### Server — `packages/backend/src/driver-feed/`

| File         | Role                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `annex-b.ts` | Incremental access-unit splitter. ffmpeg writes an undelimited byte stream to a pipe, so `-bsf:v h264_metadata=aud=insert` guarantees every AU opens with an Access Unit Delimiter and the boundary rule becomes exact. Classifies each unit as keyframe / decoder entry point. |
| `encoder.ts` | The second ffmpeg process, hand-rolled rather than via `prepareStream` (which muxes NUT for Discord's demuxer and pillarboxes onto 16:9). Encoder _settings_ are still shared — the VAAPI flags are lifted from `Encoders.vaapi()`.                                             |
| `hub.ts`     | Fan-out. One encode, N subscribers, per-client `needsKeyframe` gating.                                                                                                                                                                                                          |
| `index.ts`   | `DriverFeedService`: owns the `/video` route for the process lifetime and the encoder for one session.                                                                                                                                                                          |

Three decisions worth keeping:

- **The tee sits after the overlay.** Drivers get pixel-identical frames to the
  stream, including the burned-in HUD clock — which means the browser can read
  its own glass-to-glass latency off its own canvas using the overlay's existing
  glyph table. That is a better measurement rig than the current PinchTab
  `getStats` probe, and it costs nothing: the frame is a dedicated Buffer
  transferred zero-copy out of the emulator Worker, and nothing mutates it after
  `applyStreamOverlays` returns, so both sinks can hold the same reference. An
  overlay-free variant would cost a 614 KB memcpy per frame.
- **A joining client waits for the next entry point** (~1 s at the defaults)
  rather than being replayed a buffered GOP. Replay would make the client decode
  a second of video as fast as it can before settling; the wait is simpler,
  bounded, and uses the same `needsKeyframe` mechanism as backpressure recovery.
- **Backpressure is per-client and self-healing.** Past
  `max_client_buffer_bytes` a client's deltas are dropped and it resyncs at the
  next keyframe. This bound is the whole point — the Go-Live path once queued
  3.47 GB against a 4 GiB pod limit by letting one slow consumer accumulate
  (`archive/completed/2026-06-19_mk64-stream-backpressure.md`).

### Wire protocol — `packages/common/src/model/driver-feed.ts`

Text handshake, then binary media. The server states the codec because
`VideoDecoder.configure` needs an exact profile/level string; profile and level
are pinned (`main`, level 40) so `H264_CODEC_STRING` is exact rather than
inferred. Each binary message is a one-byte header (bit 0 = decoder entry point)
followed by one access unit. The client needs that flag because mislabelling an
`EncodedVideoChunk` throws and kills the decoder — and the server has already
parsed the NAL types for its own fan-out decisions, so re-parsing in every client
would be waste.

No `description` is sent to `VideoDecoder`: per the W3C AVC registration,
omitting it selects Annex-B, which is what a live stream with in-band SPS/PPS is.

### Transport

A `ws` server in `noServer` mode with a path-guarded `upgrade` listener, sharing
the existing HTTP server with Socket.IO. Attached mode (`new WebSocketServer({ server })`)
destroys sockets whose path does not match, which would kill Socket.IO's upgrades;
engine.io in turn ignores paths outside `/socket.io/`, so both coexist by each
declining what is not theirs. A separate connection also keeps video bytes from
ever queueing ahead of a controller input, and keeps `controller_rtt_ms` honest.

No infrastructure changes: WebSockets already traverse the Cloudflare tunnel
(Socket.IO proves it). No new port, Service, ingress, DNS record, or router forward.

## Deployment

`[driver_feed] enabled` defaults to **false** in the schema, and the whole block
uses `.prefault({})` exactly like `[leaderboard]` — the live `config.toml` is a
1Password item (`fcugoc3kohpmfwzfvko4hgysyq`), so a required section would
crash-loop the pod until someone edited the vault.

Production therefore turns it on from the Deployment instead
(`resources/mario-kart.ts`), not from the vault:

| Env                        | Value  | Why here rather than in config.toml                                                                                                                               |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRIVER_FEED_ENABLED`      | `true` | The master switch is changed in `resources/mario-kart.ts` and reconciled by ArgoCD, so Git remains the incident-control source of truth.                          |
| `DRIVER_FEED_BITRATE_KBPS` | `2500` | Same — the uplink is unmeasured, so "turn it down now" needs a small GitOps change rather than a vault edit.                                                      |
| `DRIVER_FEED_MAX_CLIENTS`  | `4`    | Capped at the four seats on purpose: the feed exists for the people driving, and each viewer costs a full copy of the stream. 4 × 2500 kbps ≈ 10 Mbps worst case. |

`resolveDriverFeedConfig` applies these over the file config. Both boolean and
numeric overrides **throw** on bad values, because a typo that silently changed
or retained an incident setting would be discovered only after the uplink was
already saturated. Operators commit the Deployment-source change and let
ArgoCD reconcile it; direct `kubectl set env` mutations are intentionally not
part of the runbook because self-heal would revert them.

Everything else needed to deploy is already in place:

- **VAAPI** — the feed reads the same `STREAM_HARDWARE_ACCELERATION` /
  `VAAPI_DEVICE` the Go-Live path does, so it uses the iGPU automatically.
- **Ingress** — `/video` is on the existing web port, so the Service, the
  `TailscaleIngress`, and the Cloudflare tunnel binding all already cover it. No
  new port, Service, or DNS record.
- **Image** — the backend runs on Bun and uses Bun's built-in `ws`
  compatibility module; no standalone npm runtime package is required. The
  frontend `dist` is already built and copied.
- **Metrics** — `driver_feed_*` live on the shared registry, so the existing
  `ServiceMonitor` scrapes them with no change.

One Cloudflare change **does** need a `tofu apply`: `sjer_red_websockets` pins
the zone's WebSocket setting to `on`. It is already on (Cloudflare's default for
every plan) and Tofu was not disabling it, but the feed serves video over a raw
WebSocket with **no polling fallback**, so a dashboard toggle would silently kill
in-browser video while the rest of the site kept working. Note that Socket.IO
working today is _not_ evidence the tunnel passes WebSockets — Socket.IO
downgrades to HTTP polling without complaining.

## Risks

| Risk                                | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Drivers leave the voice channel** | The real one. `AloneInVoiceWatcher` counts _voice-channel membership_, not stream viewership, with a 30 s grace hard-coded at `discord-plays-core/src/entry.ts:95`. All four drivers reasoning "I'm watching in the browser now, why am I in VC?" ends the session — and the driver feed with it, since it is downstream of the same emulator. Documented for now; the code fix is an optional `extraViewerCount: () => number` on `CreateGameBotOptions`, added at `game-bot.ts:285`. A one-shot `aloneWatcher.cancel()` is **not** sufficient — `evaluate()` re-arms on the next `VoiceStateUpdate`. |
| Second encode cost                  | Low. `h264_vaapi` benchmarks at ~16.7× realtime in-pod; the container sits at 0.35 / 8 cores with zero CFS throttling. ffmpeg is out-of-process, so it does not contend with the Bun main thread, where the real pressure is (`emulate_ms` p95 ≈ 30 ms of a 33 ms budget).                                                                                                                                                                                                                                                                                                                             |
| Upstream bandwidth                  | 4 drivers × ~2.5 Mbps ≈ 10 Mbps. **The homelab's uplink is undocumented and unmeasured anywhere in the repo** — no speedtest exporter, no WAN metrics, no Grafana panel. Measure before raising `bitrate_kbps` or `max_clients`.                                                                                                                                                                                                                                                                                                                                                                       |
| TCP head-of-line blocking           | Real but acceptable at 30 fps / 2.5 Mbps on a healthy link; the per-client keyframe resync is the mitigation. WebRTC fixes it properly and remains the upgrade path.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A/V skew for drivers                | Video-only in this phase, so drivers see the race ~150–250 ms before they hear it through Discord. Opus over the driver feed is the phase-2 fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Selfbot ToS exposure                | **Unchanged, not reduced.** Keeping Go-Live keeps `discord.js-selfbot-v13`, and `todos/mk64-stop-bricks-stream-account.md` still stands.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Remaining

- [ ] Measure the homelab uplink and confirm `bitrate_kbps × max_clients` fits
      (10 Mbps worst case at the shipped settings).
- [ ] `tofu apply` the `sjer_red_websockets` zone setting before relying on the
      feed through `mariokart.sjer.red`.
- [ ] Verify in a live session that `/video` connects through the Cloudflare
      tunnel — the page shows "Connecting to the game feed…" indefinitely if the
      upgrade is blocked, which is the one failure mode with no fallback.
- [ ] Confirm VAAPI is actually engaged for the second encoder in-pod (the
      measured numbers are libx264 on a laptop).
- [ ] Confirm the Go-Live path is unchanged in production (`stream_*` metrics with
      the feed on and off).
- [ ] Decide on phase 2 (Opus on the driver feed) after the first play session.
- [ ] A/B the in-page readout against the Go-Live path using the same clock, per
      the alternating-short-sessions + block-bootstrap method the burn-down plan
      requires (between-session client state swamps a naive comparison).
