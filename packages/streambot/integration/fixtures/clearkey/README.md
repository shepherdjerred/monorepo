# Synthetic ClearKey fixture

These files contain one second of generated blue video and a 440 Hz sine wave.
They contain no provider media, account credentials, or private session data.
The two deliberately public fixture keys are defined in
`integration/sports-media.integration.test.ts`.

The fixture uses separate CENC keys for audio and video. The integration test
passes it through the provider bootstrap decoder, DASH track splitting, local
resource relay, production preparation options, ffprobe, and FFmpeg decoding.
It also checks decoded PCM length and rejects a wrong key.

Generate the source with FFmpeg, then package it with
[Shaka Packager v3.9.3](https://github.com/shaka-project/shaka-packager/releases/tag/v3.9.3)
(Apache-2.0). The source is synthetic; no third-party content is incorporated.
The `packager-osx-arm64` release artifact used here has SHA-256
`b3049e743451aab5c2cd7b1316a4ce055682c41effe06a49e2e6c95a9243d351`.

Run from the repository root with that release available as `packager`:

```bash
ffmpeg -v error \
  -f lavfi -i 'color=c=blue:size=64x48:rate=10:duration=1' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=1' \
  -c:v libx264 -preset slow -g 10 -pix_fmt yuv420p \
  -c:a aac -b:a 32k -movflags +faststart /tmp/streambot-cenc-source.mp4

fixture_video_key="$(printf '%s%s' 0123456789abcdef 0123456789abcdef)"
fixture_audio_key="$(printf '%s%s' fedcba9876543210 fedcba9876543210)"
packager \
  'in=/tmp/streambot-cenc-source.mp4,stream=video,init_segment=packages/streambot/integration/fixtures/clearkey/video-init.mp4,segment_template=packages/streambot/integration/fixtures/clearkey/video-$Number$.m4s,drm_label=VIDEO' \
  'in=/tmp/streambot-cenc-source.mp4,stream=audio,init_segment=packages/streambot/integration/fixtures/clearkey/audio-init.mp4,segment_template=packages/streambot/integration/fixtures/clearkey/audio-$Number$.m4s,drm_label=AUDIO' \
  --enable_raw_key_encryption \
  --keys "label=VIDEO:key_id=11111111111111111111111111111111:key=$fixture_video_key,label=AUDIO:key_id=22222222222222222222222222222222:key=$fixture_audio_key" \
  --protection_scheme cenc --clear_lead 0 --segment_duration 1 \
  --generate_static_live_mpd \
  --mpd_output packages/streambot/integration/fixtures/clearkey/manifest.mpd
```

The fixture is committed so test execution needs only the Streambot image's
FFmpeg and ffprobe. Packager is a fixture-generation tool, not a runtime or
test-execution dependency. FFmpeg's fragmented MP4 CENC muxer produces invalid
AAC encryption metadata, so it is not used to generate these DASH assets.
