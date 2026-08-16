---
id: streambot-hybrid-voice-assistant
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Streambot Hybrid Voice Assistant

## Objective

Add per-stream voice commands using a cascaded local `Hey Streambot` detector, committed-turn
OpenAI `gpt-transcribe` verification, and `gpt-realtime-2.1` for one-shot command transactions. A
slash command creates the playback session; the session listens locally, uploads only locally
verified candidates, executes the same permission-checked command services as slash commands,
speaks a short result over the normal Discord voice connection, and returns to local-only listening.

## Architecture

- Extend `@shepherdjerred/discord-video-stream` with opt-in normal-voice receive and assistant Opus
  send support. Preserve send-only behavior unless receive is explicitly enabled, and map received
  SSRCs to Discord user IDs before emitting decrypted Opus frames.
- Keep each receiver, speaker map, wake detector, active turn, and assistant sender owned by one
  pooled userbot session. Go Live continues to carry movie audio/video on its separate connection.
- Decode and resample with the existing libav stack. Keep bounded per-speaker PCM pre-roll buffers,
  but make no transcription or OpenAI connection before local activation.
- Run pinned, image-bundled sherpa-onnx keyword spotting as a permissive fragment candidate layer,
  then verify the two-second local window with a phrase-specific LiveKit/openWakeWord-compatible
  ONNX model. Prefer the native sherpa addon after a Bun/Linux image smoke test; retain sherpa's
  in-process WASM binding. Verify every asset checksum during the image build and never download
  models at runtime.
- Provisionally lock a candidate to its triggering speaker for 1.25 seconds, retain two seconds of
  pre-roll, and feed Silero only from the candidate boundary so the wake phrase cannot prematurely
  endpoint the command. Cap the utterance at 15 seconds and the transaction at 30 seconds, allow
  one active turn per session, and zero every audio and feature buffer on exit.
- Create a fresh official OpenAI Realtime SDK server-WebSocket session per locally verified turn.
  Commit audio to `gpt-transcribe` with no wake-phrase prompt, wait for an exact normalized leading
  `hey streambot`, `hey stream bot`, or `hey streamboat`, and create no Realtime response on a
  rejection. For an accepted transcript, delete the audio conversation item, add the command-only
  text, and only then request one audio response from `gpt-realtime-2.1` with `marin`.
- Bound cloud verification to a burst of two and five candidates per rolling minute per playback
  session, with a three-second cooldown after transcript rejection. A rejected candidate is silent;
  provider errors keep playback healthy and use the existing status-channel error path.
- Bind typed playback tools to trusted session and triggering-user context. Permit at most one
  mutating tool per wake and expose no general knowledge, web, arbitrary URL, or unrelated tools.
- Reuse command services for source resolution, machine events, errors, and authorization. `auto`
  stays local-first, `local` never falls through, and `youtube` bypasses local matches.
- Duck Go Live playback with a transient 20% multiplier while assistant speech is active, separate
  from desired playback volume, and restore the latest desired volume on every exit path.

## Operations and privacy

- Voice-disabled startup remains unchanged. Voice-enabled startup fails when configuration or
  packaged model assets are invalid.
- OpenAI failures never stop playback: post a concise status-channel notice, restore ducking, clear
  turn audio, and resume wake listening.
- Supply a dedicated Streambot OpenAI project key through 1Password. Production remains globally
  disabled with `VOICE_ASSISTANT_ENABLED=false` until the corpus, human holdout, live Discord, and
  operational gates below pass. Do not persist audio or transcripts; enable project zero-data
  retention when the account supports it.
- Record only privacy-safe aggregate metrics for wakes, abandoned/false turns, tool outcomes,
  OpenAI errors and token usage, concurrent turns, and wake-to-reply latency. Never use user IDs,
  transcripts, or media queries as labels.
- Update Streambot guidance/help, the human wiki, deployment tests, and the Grafana dashboard.

## Verification

- [x] Unit-test SDP direction, self-deaf behavior, SSRC mapping, DAVE boundaries, packet timing,
      reconnects, and cleanup in `discord-video-stream`.
- [ ] Test KWS positive/negative/near-match/music/overlap/back-to-back fixtures with all curated
      positives and zero checked-in negative-corpus activations.
- [x] Test speaker locking, pre-roll, VAD endpointing, hard timeouts, no pre-wake network calls,
      single flight, and immediate buffer deletion.
- [x] Test every tool schema, source scope, relative seek, authorization path, mutation cap,
      ambiguity, and boundary error.
- [x] Test ducking restoration across desired-volume changes, OpenAI failures, interruption, and
      stop teardown.
- [x] Run focused build, typecheck, test, and lint for Streambot, the transport fork, and homelab;
      the earlier production image ran its native KWS smoke fixture.
- [ ] Build the current production image with the complete native/WASM corpus evaluation stage and
      confirm the final layer contains the report/sentinels but no `.dopus` fixtures.
- [ ] Run the dedicated real Discord harness for wake-to-tool-to-speech, source selection,
      authorization, simultaneous same-guild isolation, and uninterrupted Go Live playback.
- [ ] Capture short reviewer demos and perform the production smoke plus metrics inspection.

## Confidence corpus and acceptance gates

The canonical confidence corpus is 400 generated clips in
`packages/streambot/test/fixtures/voice-corpus/`. Its versioned `.dopus` container stores the exact
length-prefixed 20 ms Opus packets Discord supplies, so evaluation enters the production
`DiscordOpusDecoder` and `VoiceAudioLifecycle` rather than a parallel waveform path. The manifest is
strictly validated and records provider/model/voice/style, augmentation, split, duration, generated
disclosure, and SHA-256. Verification and evaluation are offline; only the explicitly manual
generation command can contact OpenAI.

- 160 clean/moderate positives must all wake.
- 160 near-match, ordinary, dialogue, overlap, and music-like negatives must produce zero wakes.
- The 80 stress positives report 20/10/5/0 dB behavior; 10 dB and better must reach 95% recall.
- Native and WASM classifications must match for every fixture. Complete commands must endpoint
  0.65–1.5 seconds after speech, and a deterministic two-hour negative recombination must stay
  silent.
- The image evaluates the corpus as UID 1000 in an intermediate stage. Only its aggregate report
  and pass sentinel enter the production image; the fixtures do not.

The synthetic holdout is not used to tune thresholds. A separate private human holdout requires
three speakers with five complete positives, three near-misses, and two background negatives each.
`voice:human:evaluate` accepts recordings only below `.context`, evaluates both runtimes, writes an
aggregate result with no names or transcripts, and then deletes the raw recording directory.

The credentialed live harness uses two real speaker accounts and two same-guild sessions. It
requires assistant identity and DAVE readiness, attributes/decrypts/decodes only that assistant's
reply packets, checks exact wake/turn/tool/reply/duck/failure/token deltas, exercises all nine tools
and source restrictions, changes desired volume while ducked, verifies every reply lands in the
ten-second latency bucket, proves self-wake prevention and Go Live progress, exercises overlapping
speakers in one channel, holds stop teardown through its confirmation, and finishes with a
30-minute negative soak. The full matrix must pass twice consecutively before global enablement.

## Operator commands

```bash
cd packages/streambot
OPENAI_API_KEY=... bun run voice:corpus:generate
bun run voice:corpus:generate --refresh
bun run voice:corpus:verify
VOICE_ASSETS_DIR=/opt/streambot/voice bun run voice:corpus:evaluate
bun run voice:human:evaluate \
  --input-dir ../../.context/streambot-human-holdout \
  --assets-dir /opt/streambot/voice
bun run voice:harness:prepare
bun run voice:harness --list-devices
OPENAI_API_KEY=... bun run voice:harness --device <avfoundation-index>
OPENAI_API_KEY=... bun run voice:harness --device <avfoundation-index> --save-recordings
bun run voice:harness:evaluate \
  --positive-dir ../../.context/streambot-voice-recordings \
  --positive-pattern '^trial-' \
  --negative-dir ../../.context/streambot-kws-negatives \
  --runtime native
bun run voice:verifier:package \
  --livekit-dir ../../.context/livekit-wakeword \
  --model-dir <persistent-output>/hey_streambot_cascade \
  --threshold <reviewed-threshold>
bun run e2e:voice-assistant
E2E_VOICE_EXPECT_INVALID_CREDENTIALS=true \
  OPENAI_API_KEY=<intentionally-invalid> bun run e2e:voice-assistant
```

Generation is resumable; replacing an existing canonical fixture requires the explicit refresh.
Offline verification, evaluation, preparation, and device listing do not contact OpenAI. The local
probe creates one Realtime session only after a completed wake, and the credentialed live harness
also contacts OpenAI. Set `VOICE_ASSISTANT_ENABLED=true` only after these gates and project
budget/ZDR configuration are recorded. Roll back globally to `false` on any false wake, stuck duck,
cross-session action, repeated OpenAI error, or privacy violation.

## Remaining

- [x] Implement the transport, local audio lifecycle, Realtime agent, shared command services,
      replies, metrics, deployment configuration, help, package guidance, and human wiki page.
- [x] Implement the canonical corpus schema/container, deterministic recipe expansion, resumable
      OpenAI/Apple generator, offline verifier, production-pipeline evaluator, human holdout
      evaluator, injectable Realtime transport suite, and strengthened live harness.
- [x] Add the macOS local voice probe: AVFoundation microphone ingress enters the production Opus,
      wake-word, VAD, and Realtime path; a dry-run command port prints the typed playback operation
      instead of mutating a session. Both production and probe use the same committed-turn
      transcription gate; only the probe displays its ephemeral transcript.
- [x] Implement typed permissive sherpa candidates, provisional speaker locking, the in-process
      mel/embedding/classifier ONNX graph, candidate-boundary VAD, strict transcript-prefix gate,
      command-only Realtime input, per-session cloud limiting, stage metrics, and harness/evaluator
      stage reporting. The model manifest intentionally prevents packaging the rejected prototype.
- [ ] Generate and review all 400 canonical clips with the dedicated Streambot key, then pass the
      native/WASM image thresholds without tuning on either holdout.
- [ ] Retrain and package the phrase verifier with at least 20,000 positives, 40,000 adversarial
      near-matches, and 25 hours of general speech/noise, then pass its macOS and Linux/Bun runtime
      smoke tests plus the stage-by-stage corpus gates.
- [ ] Collect and evaluate the private three-speaker human holdout.
- [ ] Run the complete credentialed Discord/OpenAI matrix twice consecutively and capture reviewer
      demos. The harness exists but has not been executed against live Discord.
- [ ] Complete privileged real-Discord, OpenAI-project, image-registry, deployment, and production
      verification with operator credentials. Add the required `streambot-openai` secret reference
      to GitOps only when the global enablement gate is approved; disabled production deliberately
      carries neither an optional nor a dangling secret reference.

## Comment Log

- 2026-08-08: Mirrored the approved implementation plan before code changes.
- 2026-08-08: Focused source suites and the production image build passed. The required non-root
  image smoke loaded the pinned native sherpa runtime and checksum-verified KWS/VAD assets.
- 2026-08-08: Added a macOS operator harness for local-versus-YouTube voice requests, spoken
  replies, authorization denial, and simultaneous same-guild isolation. It remains pending live
  execution with two speaker accounts, two channels, model assets, and the dedicated OpenAI key.
- 2026-08-09: Added the confidence corpus system, real native/WASM pipeline evaluator,
  deterministic official-Realtime transport, attributed DAVE reply checks, exact acceptance
  metrics, private human holdout workflow, and global-disabled deployment gate. The referenced
  `streambot-openai` 1Password item does not yet exist, so canonical OpenAI fixture generation and
  all credentialed acceptance remain operator-blocked.
- 2026-08-09: Focused verification passed: 502 Streambot tests, 83 discord-video-stream tests,
  package builds/typechecks/lints, homelab deployment checks, docs build, docs schema, formatting,
  and the non-root Linux image smoke loading the native KWS/VAD runtime. The corpus verifier fails
  closed on the deliberately absent canonical manifest, so the full image target cannot pass until
  the dedicated key is available and all 400 reviewed fixtures are checked in.
- 2026-08-09: Approved a lightweight macOS console probe for threshold tuning. Only microphone
  ingress, displayed transcription, and dry-run execution may differ from production; KWS/VAD,
  Discord Opus codecs, Realtime agent configuration, tool schemas, and mutation limits stay shared.
  Probe recordings and transcripts are ephemeral and do not count as acceptance holdouts.
- 2026-08-09: Implemented the local probe and prepared its checksum-verified assets through the
  scratch image target. A macOS smoke selected the native sherpa runtime and exited cleanly; 513
  Streambot tests, 83 discord-video-stream tests, focused builds/typechecks/lints, docs checks, and
  wiki browser tests passed. A spoken trial using the dedicated OpenAI key remains operator-only
  acceptance and does not count as a holdout.
- 2026-08-09: After real microphone trials missed the wake phrase, added an explicit diagnostic
  recording mode. It saves lossless pre-Opus WAV files only under an operator-selected local
  `.context` path, reports peak/RMS levels, and preserves the non-persistent default.
- 2026-08-09: The saved café trials exposed a sherpa packaging regression rather than silent input:
  version 1.13.4 loaded successfully but failed the GigaSpeech model's own `LIGHT UP` positive.
  Pinned the JavaScript, native platform, and WASM packages to 1.13.1, added functional native/WASM
  startup recognition, and changed the acoustic keyword to the stable `HEY STREAM` prefix of the
  spoken `Hey Streambot` phrase. The second saved trial now activates through the exact Opus path;
  corpus and untouched human-negative gates remain required before production enablement.
- 2026-08-09: Four additional café trials revealed two independent recall gaps. Added conservative
  `STREAMBOT` compound and `STREAM BOT` tokenizations at the existing score/threshold; their union
  with `HEY STREAM` activates all four saved positives through Opus without lowering the threshold.
  Also warm Silero with the already-retained wake pre-roll: sherpa returned at 1.44–1.76 seconds in
  the successful clips, too late for a newly cold VAD to observe enough trailing speech. All four
  private clips now reach a completed offline turn through the production lifecycle. The expanded
  matcher still requires the untouched negative corpus and human holdout before enablement.
- 2026-08-09: Five further café trials activated three times through the exact Opus path; two were
  genuine KWS misses across every safe phrase tokenization tested. The activated `Hey Streambot,
test` turns correctly executed no playback tool, but diagnostic Realtime transcription was
  German or empty. Added English wake-phrase context to harness-only transcription and made
  `--save-recordings` also persist the exact audio committed to OpenAI. Noise filtering reduced
  recall on these samples, so production preprocessing and thresholds were left unchanged pending
  the synthetic tuning corpus and negative gates.
- 2026-08-10: Added `voice:harness:evaluate` so private diagnostic directories replay offline
  through the production Discord Opus encoder/decoder and `VoiceAudioLifecycle`. The current
  packaged sherpa matcher scored 8/11 intended wakes and 34/48 hard negatives, including 14 false
  activations, so threshold loosening and production enablement remain blocked. Requiring the full
  phrase reduced false activations but collapsed recall to at most 4/11.
- 2026-08-10: Trained an isolated phrase-specific ONNX prototype without exposing the human files
  to training. The corrected run used 2,000 positive clips, 1,000 adversarial clips, 500 standalone
  MUSAN backgrounds, general-speech negatives, room impulse responses, and noisy augmentation. It
  reached 93.6% synthetic recall with 9.96 FPPH, then failed the untouched post-Discord-Opus
  holdout: a zero-false-wake threshold detected 0/11 intended wakes. The prototype was not copied
  into production assets; global voice remains disabled.
- 2026-08-10: Approved the cascaded replacement after the single sherpa operating point showed both
  misses and false activations. The durable target is permissive sherpa fragments, a separately
  trained local ONNX phrase verifier, Silero command endpointing, then committed-turn
  `gpt-transcribe` as the hard wake gate before any `gpt-realtime-2.1` response or playback tool.
  Picovoice is intentionally excluded to avoid a second credential and opaque personal-project
  licensing. Production remains globally disabled until the expanded local, transcript, live, and
  operational gates pass.
- 2026-08-10: The implemented permissive 0.05 sherpa fragment layer nominated 10/11 private cafe
  positives and 29/48 generated hard negatives. The high local candidate rate is intentional; the
  remaining private miss and every false candidate reinforce that sherpa is not an acceptance
  decision. The new phrase verifier must still pass the untouched corpus and human gates before
  its trained classifier can be packaged.
- 2026-08-10: The complete deterministic source suites now pass: 524 Streambot tests and 83
  discord-video-stream tests, plus focused typecheck/lint/build, homelab dashboard/deployment
  checks, and the wiki build/typecheck/tests/lint. The current 6,000-positive/3,000-adversarial
  prototype is rejected by the packager. The Linux image smoke also fails closed on the absent
  phrase-verifier assets, and the corpus verifier remains blocked on the absent 400-clip manifest.
  No accepted classifier, corpus, human holdout, or live Discord result exists yet, so production
  remains disabled.
- 2026-08-16: Trained the canonical recipe to completion on Apple Silicon (MPS), packaged the
  verifier, generated the corpus, and measured the cascade end to end. The classifier itself is
  good on its own distribution: 94.4% recall at 0.000 FPPH on 23.4 validation hours, optimal
  threshold 0.70, AUT 0.0002 — well past the rejected prototype's 65.3% at 0.058. Packaging
  attests 120,000 positives and 120,000 adversarial negatives against the full 16.09 GiB ACAV100M
  artifact, and the Linux image `voice-smoke` stage now passes on both runtimes.
- 2026-08-16: Found and fixed a wake-window alignment defect that made local verification score
  audio the model had never been shown. The verifier scores the last two seconds it is handed and
  trains end-aligned, but the lifecycle closed its window 1250 ms after sherpa _emitted_ a
  candidate, leaving the phrase ~915 ms from the edge; measured tolerance collapses from 0.98 to a
  0.002 floor past ~350 ms. Proof it was integration and not training: the verifier rejects its own
  packaged smoke fixture through the production path and accepts it when called directly. No fixed
  delay fixes it — sherpa reports a match a variable ~280 ms after the audio, and its six fragments
  end at different points in the phrase — so the window is now anchored to sherpa's per-token
  timestamps plus a per-fragment tail. Real cafe recall went 0/11 to 5/11; a swept fixed delay
  never beat 1/11.
- 2026-08-16: Corpus evaluation over all 400 clips plus the two-hour negative soak does NOT pass,
  and the gap is not a threshold tweak. Native/WASM: clean positive recall 0.800/0.794 (gate 1.0),
  stress >=10 dB 0.700/0.675 (gate 0.95), negative activations 24/160, endpoint violations
  201/203, and the runtimes do not classify identically — a hard invariant, not a tunable bar. The
  soak fired 80 times in two hours, i.e. 40 false wakes per hour in an idle room, well under the
  per-session limiter's 300/hour so that limiter never binds. 80% recall is on synthetic clips of
  the phrase the model trained on, which is the friendly case. Recommendation recorded: the local
  verifier does not discriminate well enough to run unattended, and the next step is replacing it
  (Picovoice Porcupine's free tier, or a local ASR such as Moonshine/Whisper-tiny transcribing the
  candidate window) rather than another training cycle. Production remains disabled.
