import type { AudioFrameSink } from "@shepherdjerred/discord-video-stream";

/**
 * The handles {@link ../streamer/voice-audio-mixer.ts VoiceAudioMixer} hands out, and the only way
 * anything else in this package puts audio on the userbot's outbound voice track.
 *
 * They live in their own module rather than beside the mixer because `voice/` names
 * {@link AssistantAudioPort} in its own types, and a boundary that both layers can import keeps
 * the assistant from depending on the mixer implementation to name the contract it uses.
 */

/**
 * The slice of the fork's `VoiceConnection` the mixer touches: the RTP speaking opcode, and the
 * WebRTC wrapper that actually puts a frame on the wire.
 *
 * Structural rather than the concrete class so tests drive the mixer without a live Discord
 * connection. `sendAudioFrame` returning `false` is the whole reason this feature can report a
 * failure at all — the wrapper returns it when the peer connection is not ready or no audio
 * packetizer is installed, and both of those are otherwise completely silent.
 */
export type VoiceConnectionLike = {
  setSpeaking: (speaking: boolean) => void;
  webRtcConn: AudioFrameSink;
};

/**
 * One media segment's write access to the outbound track.
 *
 * Satisfies the fork's `AudioFrameSink` structurally, so it is passed straight to
 * `PlayStreamOptions.audioSink` with no wrapper and no assertion. Opening a port supersedes any
 * previous one: a frame arriving on a superseded or closed port is dropped rather than sent, which
 * is what stops a torn-down `AudioStream` from writing onto a connection the next segment (or the
 * next session's userbot) now owns.
 */
export type MusicAudioPort = AudioFrameSink & {
  /** Retire this port. Idempotent; safe to call from a `finally` that may run twice. */
  close: () => void;
};

/**
 * The voice assistant's write access to the same track.
 *
 * `send` is the backpressure seam. It resolves when the packet's 20 ms of airtime has elapsed, so
 * the caller's loop is paced by awaiting it rather than by sleeping a fixed 20 ms of its own — the
 * difference being that this schedule is anchored to a deadline and does not accumulate the cost of
 * the send itself, which over a long reply the old `Bun.sleep(20)` loop did. Because the caller
 * awaits each packet, at most one is ever outstanding: there is no queue here to bound and no drop
 * policy to get wrong.
 */
export type AssistantAudioPort = {
  /** Send one 20 ms Opus packet. Rejects when the connection is gone or refused the frame. */
  send: (opus: Uint8Array) => Promise<void>;
  /**
   * Declare whether this port is currently speaking. The mixer — not the caller — owns the RTP
   * speaking flag, because music and the assistant share one connection: an assistant clearing the
   * flag at the end of its reply would drop the green ring in the middle of a song.
   */
  setSpeaking: (speaking: boolean) => void;
  /**
   * Release the port. Clears this port's speaking claim and abandons any packet still waiting on
   * the music clock, so a caller blocked in `send` during a teardown is released rather than
   * deadlocked. Idempotent.
   */
  close: () => void;
};
