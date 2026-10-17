import { PassThrough } from "node:stream";
import type { EncoderHandles } from "@shepherdjerred/discord-stream-lifecycle/types";

export function encoderFixture(): EncoderHandles {
  const sink = new PassThrough();
  return {
    sink,
    output: new PassThrough(),
    playing: Promise.resolve(),
    stop: () => {
      sink.end();
    },
  };
}
