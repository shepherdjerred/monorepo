import { describe, expect, test } from "bun:test";
import { AssistantAudioOutput } from "@shepherdjerred/streambot/streamer/assistant-audio-output.ts";

describe("AssistantAudioOutput", () => {
  test("ducks independently and restores the latest desired volume", async () => {
    const applied: number[] = [];
    const speaking: boolean[] = [];
    const output = new AssistantAudioOutput(
      () => ({
        setVolume: (volume: number) => {
          applied.push(volume);
          return Promise.resolve(true);
        },
      }),
      () => ({
        setSpeaking: (value) => {
          speaking.push(value);
        },
        webRtcConn: {
          sendAudioFrame: () => {
            /* packet transport is not exercised in this volume test */
          },
        },
      }),
    );

    await output.setVolume(100);
    await output.setSpeaking(true);
    await output.setVolume(50);
    await output.setSpeaking(false);

    expect(applied).toEqual([1, 0.2, 0.1, 0.5]);
    expect(speaking).toEqual([true, false]);
  });

  test("records an unducked state even when restoration apply fails", async () => {
    let rejectNext = false;
    const applied: number[] = [];
    const output = new AssistantAudioOutput(
      () => ({
        setVolume: (volume: number) => {
          if (rejectNext) {
            rejectNext = false;
            return Promise.reject(new Error("player stopping"));
          }
          applied.push(volume);
          return Promise.resolve(true);
        },
      }),
      () => null,
    );
    await output.setSpeaking(true);
    rejectNext = true;
    await expect(output.setSpeaking(false)).rejects.toThrow("player stopping");
    await output.setVolume(80);
    expect(applied.at(-1)).toBe(0.8);
  });
});
