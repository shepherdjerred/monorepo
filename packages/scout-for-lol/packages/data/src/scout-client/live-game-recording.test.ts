import { describe, expect, test } from "vitest";
import rawProtocolContract from "./protocol.contract.json" with { type: "json" };
import fixtures from "./live-game-recording.fixtures.json" with { type: "json" };
import {
  checkLiveGameRecording,
  LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES,
  LiveGameRecordingPayloadSchema,
  LiveGameRecordingRefusalSchema,
} from "./live-game-recording.ts";
import { ScoutClientObservationSchema } from "./protocol.schema.ts";

/** A deep copy of the shared fixture, for a test to damage. */
function recording(): {
  resource: string;
  data: {
    samples: {
      snapshot: { participants: Record<string, unknown>[] } & Record<
        string,
        unknown
      >;
    }[];
  } & Record<string, unknown>;
} {
  return structuredClone(fixtures.recording);
}

describe("live_game_recording", () => {
  test("is a kind of the shared contract, capped at about a megabyte", () => {
    expect(rawProtocolContract.observationKinds).toContain(
      "live_game_recording",
    );
    expect(LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES).toBe(1_048_576);
  });

  test("accepts the recording the desktop client writes", () => {
    expect(LiveGameRecordingPayloadSchema.parse(fixtures.recording)).toEqual(
      fixtures.recording,
    );
    expect(checkLiveGameRecording(fixtures.recording).accepted).toBe(true);
  });

  test("rides in an ordinary observation envelope", () => {
    expect(
      ScoutClientObservationSchema.safeParse({
        protocolVersion: 1,
        schemaVersion: 1,
        observationId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
        sequence: 1,
        capturedAt: "2026-11-14T12:00:00Z",
        appVersion: "0.1.0",
        kind: "live_game_recording",
        gameId: "5653248720",
        payload: fixtures.recording,
      }).success,
    ).toBe(true);
  });

  test.each([
    "riotId",
    "riotIdGameName",
    "riotIdTagLine",
    "summonerName",
    "skinName",
    "skinID",
    "wardScore",
    "cooldown",
    "position",
    "puuid",
  ])("refuses a %s key with a typed reason", (key) => {
    const damaged = recording();
    const participant = damaged.data.samples[0]?.snapshot.participants[0];
    if (participant === undefined) throw new Error("fixture has no player");
    participant[key] = "anything";
    const check = checkLiveGameRecording(damaged);
    expect(check).toEqual({
      accepted: false,
      reason: "forbidden_key",
      detail: key,
    });
  });

  test("names the key, never the value, in the refusal", () => {
    const damaged = recording();
    const participant = damaged.data.samples[0]?.snapshot.participants[0];
    if (participant === undefined) throw new Error("fixture has no player");
    participant["summonerName"] = "Some Secret Name";
    const check = checkLiveGameRecording(damaged);
    expect(JSON.stringify(check)).not.toContain("Some Secret Name");
  });

  test("refuses a key the allowlist does not have, even a harmless one", () => {
    const damaged = recording();
    const sample = damaged.data.samples[0];
    if (sample === undefined) throw new Error("fixture has no sample");
    sample.snapshot["extra"] = 1;
    expect(checkLiveGameRecording(damaged)).toMatchObject({
      accepted: false,
      reason: "invalid_shape",
    });
  });

  test("refuses a recording over the size cap", () => {
    const damaged = recording();
    const sample = damaged.data.samples[0];
    if (sample === undefined) throw new Error("fixture has no sample");
    const copies = Math.ceil(
      LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES / JSON.stringify(sample).length,
    );
    damaged.data.samples = Array.from({ length: copies + 1 }, () =>
      structuredClone(sample),
    );
    expect(checkLiveGameRecording(damaged)).toMatchObject({
      accepted: false,
      reason: "too_large",
    });
  });

  test("refuses a recording with no samples and a wrong resource", () => {
    const empty = recording();
    empty.data.samples = [];
    expect(checkLiveGameRecording(empty).accepted).toBe(false);
    const wrong = recording();
    wrong.resource = "live_game_frame";
    expect(checkLiveGameRecording(wrong).accepted).toBe(false);
  });

  test("the refusal body is a typed shape", () => {
    expect(
      LiveGameRecordingRefusalSchema.parse({
        error: "live_game_recording_refused",
        reason: "forbidden_key",
        observationId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
        detail: "riotId",
      }),
    ).toBeDefined();
  });
});
