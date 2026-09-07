/**
 * Where an {@link ./AudioStream.js AudioStream} hands each paced Opus frame.
 *
 * {@link ../client/voice/WebRtcWrapper.js WebRtcConnWrapper} satisfies this structurally, so the
 * default (send straight to the connection) needs no wrapper and no type assertion. A consumer that
 * wants to sit in front of the transport — to apply gain, or to mix a second source into the same
 * RTP stream — passes its own implementation as {@link ../media/newApi.js PlayStreamOptions.audioSink}
 * and forwards to the connection itself.
 *
 * `sendAudioFrame` returns whether the frame actually went out. A sink that drops a frame — no RTP
 * packetizer installed, transport not connected — must say so: the pacer keeps running either way,
 * so a silent `false` is a whole track "playing" to silence while playback reports a clean end.
 */
export type AudioFrameSink = {
  sendAudioFrame(frame: Buffer, frametimeMs: number): boolean;
};
