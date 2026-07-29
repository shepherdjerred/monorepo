import { describe, expect, test } from "bun:test";
import { Client } from "discord.js-selfbot-v13";
import type { MediaConnectionCloseInfo } from "../src/client/voice/BaseMediaConnection.js";
import { StreamConnection } from "../src/client/voice/StreamConnection.js";
import { VoiceConnection } from "../src/client/voice/VoiceConnection.js";
import { Streamer } from "../src/client/Streamer.js";

const CLOSE: MediaConnectionCloseInfo = {
  code: 4014,
  canResume: false,
  deliberate: true,
};

function makeConnections(): {
  voice: VoiceConnection;
  first: StreamConnection;
  second: StreamConnection;
} {
  const streamer = new Streamer(new Client());
  const voice = new VoiceConnection(
    streamer,
    "guild-1",
    "bot-1",
    "channel-1",
    () => {},
  );
  const first = new StreamConnection(
    streamer,
    "guild-1",
    "bot-1",
    "channel-1",
    () => {},
  );
  const second = new StreamConnection(
    streamer,
    "guild-1",
    "bot-1",
    "channel-1",
    () => {},
  );
  return { voice, first, second };
}

describe("VoiceConnection stream close relay", () => {
  test("forwards the active Go-Live close exactly once", () => {
    const { voice, first } = makeConnections();
    const closes: MediaConnectionCloseInfo[] = [];
    voice.on("close", (info) => closes.push(info));

    voice.streamConnection = first;
    first.emit("close", CLOSE);

    expect(closes).toEqual([CLOSE]);
  });

  test("detaches the old child when the Go-Live connection changes", () => {
    const { voice, first, second } = makeConnections();
    const closes: MediaConnectionCloseInfo[] = [];
    voice.on("close", (info) => closes.push(info));

    voice.streamConnection = first;
    voice.streamConnection = second;
    first.emit("close", CLOSE);
    expect(closes).toHaveLength(0);

    second.emit("close", CLOSE);
    expect(closes).toEqual([CLOSE]);

    voice.streamConnection = undefined;
    second.emit("close", CLOSE);
    expect(closes).toEqual([CLOSE]);
  });
});
