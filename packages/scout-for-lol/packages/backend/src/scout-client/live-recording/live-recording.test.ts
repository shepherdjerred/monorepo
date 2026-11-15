import { describe, expect, test } from "vitest";
import {
  LiveGameRecordingRefusalSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";
import fixtures from "@scout-for-lol/data/scout-client/live-game-recording.fixtures.json" with { type: "json" };
import { observedGameState } from "#src/scout-client/lobby-payload.ts";
import {
  refuseInvalidLiveRecordings,
  ScoutClientLiveRecordingRefused,
} from "./live-recording.ts";

function recordingObservation(payload: unknown) {
  return ScoutClientObservationSchema.parse({
    protocolVersion: 1,
    schemaVersion: 1,
    observationId: crypto.randomUUID(),
    sequence: 1,
    capturedAt: "2026-11-14T12:00:00Z",
    appVersion: "0.1.0",
    kind: "live_game_recording",
    payload,
  });
}

describe("refusing live game recordings at ingress", () => {
  test("lets an allowlisted recording through", () => {
    expect(() => {
      refuseInvalidLiveRecordings([recordingObservation(fixtures.recording)]);
    }).not.toThrow();
  });

  test("refuses a recording that carries a Riot ID with a typed body", () => {
    const damaged = structuredClone(fixtures.recording);
    Object.assign(damaged.data.samples[0]?.snapshot.participants[0] ?? {}, {
      riotId: "Someone#NA1",
    });
    const observation = recordingObservation(damaged);
    let refusal: unknown;
    try {
      refuseInvalidLiveRecordings([observation]);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ScoutClientLiveRecordingRefused);
    if (!(refusal instanceof ScoutClientLiveRecordingRefused)) return;
    const body = LiveGameRecordingRefusalSchema.parse(refusal.body());
    expect(body).toEqual({
      error: "live_game_recording_refused",
      reason: "forbidden_key",
      observationId: observation.observationId,
      detail: "riotId",
    });
    expect(JSON.stringify(body)).not.toContain("Someone");
  });

  test("ignores every other kind, including the old raw frame", () => {
    expect(() => {
      refuseInvalidLiveRecordings([
        ScoutClientObservationSchema.parse({
          ...recordingObservation({}),
          kind: "live_game_frame",
          payload: {
            resource: "live_game_frame",
            data: { allPlayers: [{ riotId: "a#b" }] },
          },
        }),
      ]);
    }).not.toThrow();
  });
});

describe("what a live game observation means to the lobby projection", () => {
  test("a recording is not evidence that a game is playing", () => {
    expect(
      observedGameState(recordingObservation(fixtures.recording)),
    ).toBeNull();
  });

  test("the marker the desktop sends for a live frame still means playing", () => {
    // AI-635: the consumer reads the kind and never the payload, so the
    // minimal marker the client now sends keeps the projection unchanged.
    for (const data of [{ inProgress: true }, { allPlayers: [] }, {}]) {
      expect(
        observedGameState(
          ScoutClientObservationSchema.parse({
            ...recordingObservation({}),
            kind: "live_game_frame",
            payload: { resource: "live_game_frame", data },
          }),
        ),
      ).toBe("PLAYING");
    }
  });
});
