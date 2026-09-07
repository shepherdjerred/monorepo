/**
 * The arithmetic one 20 ms Discord audio frame goes through when the mixer is not in passthrough,
 * split out from {@link ./voice-audio-mixer.ts} so it can be tested against exact sample values
 * with no codec, no connection, and no lifecycle around it.
 *
 * Everything here is pure. That matters more than usual: this is the only genuinely new DSP in the
 * music-over-voice feature, and a bug in it garbles every source on the userbot's outbound track —
 * the music AND the voice assistant — with no exception, no log line, and no metric that would
 * distinguish it from a bad encode upstream.
 */

/** Discord's outbound voice format. Both the fork's frame codecs and this module assume it. */
export const DISCORD_SAMPLE_RATE = 48_000;
export const DISCORD_CHANNELS = 2;

/**
 * Samples per channel in one Opus frame at Discord's 20 ms frame duration. `DiscordOpusFrameEncoder`
 * opens libopus with exactly this frame size, so feeding it one frame of this length yields exactly
 * one packet — which is what keeps "one emit per input frame" true and RTP timestamps continuous.
 */
export const FRAME_SAMPLES_PER_CHANNEL = 960;

/** Interleaved `[L, R, L, R, …]` length of one frame. */
export const FRAME_SAMPLE_COUNT = FRAME_SAMPLES_PER_CHANNEL * DISCORD_CHANNELS;

/** Frame duration in milliseconds, and therefore the frametime a re-encoded frame is sent with. */
export const FRAME_DURATION_MS = 20;

/**
 * Attenuation applied to music while the assistant is speaking. Unchanged from the value
 * `AssistantAudioOutput.apply()` computed before this module existed — the difference is that the
 * factor now reaches the samples instead of an ffmpeg filter that Bun cannot talk to.
 */
export const ASSISTANT_DUCK_FACTOR = 0.2;

/**
 * Gain the music track is multiplied by: the user's desired volume, ducked while the assistant
 * speaks. Percentages above 100 are allowed (the volume command accepts 0-200) and clip in
 * {@link mixFrame} rather than wrapping.
 */
export function musicGain(
  desiredVolumePercent: number,
  assistantSpeaking: boolean,
): number {
  const duck = assistantSpeaking ? ASSISTANT_DUCK_FACTOR : 1;
  return (Math.max(0, desiredVolumePercent) / 100) * duck;
}

/**
 * Sum one frame of gain-adjusted music with one frame of assistant speech.
 *
 * `assistant` is `null` whenever no assistant packet was waiting when this music frame arrived —
 * which is the ordinary case even mid-reply, because the two producers run on independent 50 Hz
 * clocks and only one of them can be first. The missing samples are therefore treated as
 * **silence**, never as a repeat of the previous assistant frame: repeating would be audible as a
 * stutter and, worse, would be indistinguishable from working audio in a test that only asserted
 * "something was sent".
 *
 * The assistant is deliberately NOT scaled by the music gain. Ducking exists to make the assistant
 * audible over the music; attenuating it by the same factor would defeat the whole mechanism, and
 * at `volume 0` it would silence the assistant entirely.
 *
 * The sum is clamped rather than allowed through: two sources at full scale, or a `volume 200`
 * request, exceed the ±1 float range libopus expects, and an un-clamped overflow is heard as
 * broadband crackle rather than as loudness.
 */
export function mixFrame(
  music: Float32Array,
  gain: number,
  assistant: Float32Array | null,
): Float32Array {
  const mixed = new Float32Array(music.length);
  for (const [index, sample] of music.entries()) {
    const summed = sample * gain + (assistant?.[index] ?? 0);
    mixed[index] = Math.max(-1, Math.min(1, summed));
  }
  return mixed;
}
