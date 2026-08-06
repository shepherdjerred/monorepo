---
id: mk64-stream-latency-correlation-desync
type: todo
status: planned
board: true
verification: agent
disposition: active
source_marker: false
---

# Fix MK64 stream-latency correlation so histograms tell the truth

The 2026-08-02 attribution session proved the #1779 passive latency
histograms report ~1.0–1.2 s that does not physically exist, and the
2026-08-03 adversarial review sharpened both the evidence and the mechanism.

## Confirmed facts (2026-08-03 review)

- **The contradiction is airtight in a fully-observed window**: all 25
  `stream_input_to_send_complete_ms` observations during the glass-observed
  phase-2 window read ≥1000 ms (mean 1029 ms), while the same 12 presses'
  HUD digits were photographed on a real Discord viewer's glass 35–330 ms
  after each press (decoder-verified 12/12, unique per-frame pixel stamps).
- **The originally-published mechanism is REFUTED**: ffmpeg CFR drop/dup
  cannot break the 1:1 frame↔packet invariant for this command shape. The
  reviewer ran the exact argv (software-encoder stand-in) against 8 arrival
  profiles (bursty, 800 ms slow-start, mid-stream 1 s freeze, jitter, wrong
  input fps): every run emitted exactly one packet per frame (minus a
  constant single startup-boundary frame ≈ +33 ms standing shift, only).
  `-r 30` on counted rawvideo PTS is a bijection; no `fps=`/`vsync` filters
  exist in the fork.
- **Structure confirmed elsewhere**: pairing is FIFO `shift()`
  (`stream-latency-tracker.ts:85,152`); sink evictions cannot desync (only
  delivered frames enter, `game-streamer.ts:185-193`,
  `latest-frame-sink.ts:66-101`); `onPacketReady` fires at NUT demux-write
  (`discord-video-stream` `LibavDemuxer.ts:313/328`), send stats on the
  realtime send path (`BaseMediaStream.ts:173-184`); measured C3≈0 rules out
  observer-side parse lag.

## CONFIRMED 2026-08-03 — the depth gauge settles it

The `stream_tracker_video_source_depth` gauge shipped in PR #1965 was read
during a live candidate session and **directly confirms phantom head
entries**:

- Depth sits at a standing **34-36** unconsumed video sources for the whole
  session (sampled every 4 s; never drains).
- Inflation is exactly that depth in frames: across consecutive scrapes,
  the interval mean of `stream_packet_ready_delay_ms{video}` tracks
  `depth x 33.37 ms` within ±1 frame (observed 1141-1183 ms vs predicted
  1135-1201 ms).
- Real end-to-end latency measured at the viewer's glass in the same
  session is ~317 ms, so 1170 ms of genuine in-flight encode latency is
  impossible; and `MAX_BUFFERED_FRAMES = 3` caps the sink at three frames,
  so no real 35-frame backlog can exist.

Therefore every packet is paired with a source ~35 frames too old, and
every pipeline histogram derived from that pairing
(`packet_ready`, `send_complete`, `input_to_*`, and the A/V offset gauge)
is inflated by a constant ~1.17 s. Depth ~35 also matches the predicted
startup gap (~1.2 s of frames produced before the RTP session attaches).

## Corrected mechanism hypothesis

A **standing ~30-frame pairing offset created once near session startup on
the production path**, then roughly constant (35 → 30 frame-times across
windows; post→post2 packet_ready is bimodal — 24% <1 s — so occasional
extra-source consumption shrinks it). Leading suspects, in order:

1. **Early packets produced before the voice/RTP session attaches are
   discarded without reaching `onPacketReady`** — ~1 s of
   handshake ≈ ~30 frames whose sources then sit at the FIFO head forever,
   shifting every later pairing. Invisible in local probes (no Discord
   attach). Audit the fork's startup path: any packet drop between ffmpeg
   stdout and the demuxer/vPipe before `playStream` attaches.
2. **h264_vaapi-specific packet behavior** (extra/missing packets at start;
   local empirical check used libx264) — needs an in-cluster parity count.
3. The audio side pairs by duration-consumption, not FIFO — the
   `stream_av_content_offset_ms` gauge swung −162 → +710 ms in one session,
   so audio-side drift (PCM trim/drop bookkeeping) corrupts the A/V gauge
   independently. Treat the gauge as untrustworthy until re-derived.

## Remaining

- [x] **Decisive instrumentation first**: `videoSources`-depth gauge
      shipped in PR #1965. Result: standing depth 34-36 while the viewer's
      glass showed ~317 ms ⇒ phantom head entries confirmed (see the
      CONFIRMED section above). The remaining work is to find and close the
      1:1 break, not to decide whether one exists.
- [ ] Audit the fork's pre-attach packet path for silent drops (suspect 1)
      and run an in-cluster h264_vaapi frame-in/packet-out parity count
      (suspect 2).
- [ ] Fix per findings: if a startup 1:1 break — either stop the drop,
      account for it (skip N head sources on first packet), or move to
      timestamp pairing (`contentTimeMs` ↔ `ptsMs` with an explicitly
      estimated startup offset — note the offset estimation risk the review
      flagged; naive PTS pairing is a no-op on an intact 1:1 stream).
- [ ] Extend `e2e:stream-latency` with a startup/attach-gap scenario that
      reproduces the offset against the current implementation (the CFR
      drop/dup scenario idea is obsolete — refuted).
- [ ] Re-run the live attribution procedure (origin log) and confirm
      `stream_input_to_send_complete_ms` lands near the glass-verified
      ~100–150 ms; re-baseline the A/V gauge.

## Comment Log

- 2026-08-02: Filed from the input-lag attribution session.
- 2026-08-03: Adversarial review refuted the CFR drop/dup mechanism
  (empirical 1:1 across 8 arrival profiles); bucket-level recheck proved the
  contradiction inside the fully-observed window (25/25 ≥1 s vs glass
  35–330 ms). Rewrote mechanism hypothesis (startup pairing offset; VAAPI
  parity and pre-attach discard as suspects) and made the depth-gauge
  instrumentation the first step.
