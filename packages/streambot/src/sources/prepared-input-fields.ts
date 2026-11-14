import type { PreparedSportsInput } from "@shepherdjerred/streambot/sports/prepared-input.ts";

/** The private FFmpeg fields shared by candidate probing and actual playback. */
export function preparedSportsInputFields(prepared: PreparedSportsInput) {
  return {
    ffmpegInput: prepared.input,
    ffmpegInputHeaders: prepared.headers,
    ...(prepared.inputOptions === undefined
      ? {}
      : { ffmpegInputOptions: prepared.inputOptions }),
    ...(prepared.audioInput === undefined
      ? {}
      : { audioInput: prepared.audioInput }),
    ...(prepared.audioInputHeaders === undefined
      ? {}
      : { audioInputHeaders: prepared.audioInputHeaders }),
    ...(prepared.audioInputOptions === undefined
      ? {}
      : { audioInputOptions: prepared.audioInputOptions }),
  };
}
