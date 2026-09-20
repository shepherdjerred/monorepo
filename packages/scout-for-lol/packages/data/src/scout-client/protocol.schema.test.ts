import { describe, expect, test } from "vitest";
import {
  ScoutClientObservationBatchSchema,
  ScoutClientObservationSchema,
} from "./protocol.schema.ts";

const observation = {
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
  sequence: 1,
  capturedAt: "2026-09-20T12:00:00Z",
  appVersion: "0.1.0",
  kind: "gameflow",
  payload: { phase: "Lobby" },
};

describe("Scout Client protocol", () => {
  test("accepts a bounded observation batch", () => {
    expect(
      ScoutClientObservationBatchSchema.parse({ observations: [observation] }),
    ).toEqual({ observations: [observation] });
  });

  test("rejects unknown envelope fields", () => {
    expect(
      ScoutClientObservationSchema.safeParse({
        ...observation,
        admin: true,
      }).success,
    ).toBe(false);
  });

  test("rejects unsafe payload keys", () => {
    const payload = JSON.parse('{"__proto__":{"admin":true}}');
    expect(
      ScoutClientObservationSchema.safeParse({ ...observation, payload })
        .success,
    ).toBe(false);
  });

  test("rejects excessive payload nesting", () => {
    let payload: unknown = true;
    for (let index = 0; index < 18; index += 1) payload = { value: payload };
    expect(
      ScoutClientObservationSchema.safeParse({ ...observation, payload })
        .success,
    ).toBe(false);
  });

  test("measures payload string limits as UTF-8 bytes", () => {
    expect(
      ScoutClientObservationSchema.safeParse({
        ...observation,
        payload: "😀".repeat(5000),
      }).success,
    ).toBe(false);
  });
});
