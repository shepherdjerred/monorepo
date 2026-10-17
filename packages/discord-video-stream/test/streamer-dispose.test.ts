import { expect, test } from "vitest";
import { Client } from "discord.js-selfbot-v13";
import { Streamer } from "../src/client/Streamer.ts";

class CapturingStreamer extends Streamer {
  readonly sent: { code: number; data: unknown }[] = [];
  override sendOpcode(code: number, data: unknown): void {
    this.sent.push({code, data});
  }
}

test("cancelling a pending voice handshake settles before pooled reuse", async () => {
  const client = new Client();
  client.user = { id: "300" };
  const streamer = new CapturingStreamer(client);
  const controller = new AbortController();
  const joining = streamer.joinVoice("100", "200", { signal: controller.signal });
  try {
    controller.abort();
    await expect(joining).rejects.toMatchObject({ name: "AbortError" });
    expect(streamer.voiceConnection).toBeUndefined();
    expect(streamer.sent.at(-1)).toEqual({ code: 4, data: {
      guild_id: "100", channel_id: null, self_mute: true, self_deaf: false, self_video: false,
    }});
  } finally {
    streamer.dispose();
  }
});

test("leaving clears Go-Live listeners before a pooled client's next session", async () => {
  const client = new Client();
  // These tests drive the ready callbacks without a Discord login or socket.
  client.user = { id: "300" };
  const baseline = client.listenerCount("raw");
  const streamer = new CapturingStreamer(client);
  const joining = streamer.joinVoice("100", "200");
  const voice = streamer.voiceConnection;
  if (voice === undefined) throw new Error("Missing test voice connection");
  voice.setSession("first-session");
  voice.ready(voice.webRtcConn);
  await joining;
  const starting = streamer.createStream();
  const stream = voice.streamConnection;
  if (stream === undefined) throw new Error("Missing test stream connection");
  stream.ready(stream.webRtcConn);
  await starting;

  try {
    streamer.leaveVoice();
    expect(streamer.sent.at(-1)).toEqual({ code: 4, data: {
      guild_id: "100", channel_id: null, self_mute: true, self_deaf: false, self_video: false,
    }});
    client.emit("raw", {
      t: "STREAM_CREATE",
      d: { stream_key: "guild:100:200:300", rtc_server_id: "501" },
    });
    expect(stream.serverId).toBeNull();
    expect(streamer.voiceConnection).toBeUndefined();
    streamer.dispose();
    expect(client.listenerCount("raw")).toBe(baseline);
    const replacement = new Streamer(client);
    expect(client.listenerCount("raw")).toBe(baseline + 1);
    replacement.dispose();
    streamer.dispose();
    expect(client.listenerCount("raw")).toBe(baseline);
    expect(client.user.id).toBe("300");
  } finally {
    streamer.dispose();
  }
});
