import { expect, test } from "vitest";
import { ScoutClientObservationSchema } from "@scout-for-lol/data";
import { withObserverPlatform } from "./platform-context.ts";

const observation = ScoutClientObservationSchema.parse({
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: crypto.randomUUID(),
  sequence: 1,
  capturedAt: new Date().toISOString(),
  appVersion: "0.1.0",
  kind: "gameflow",
  localPuuid: "p".repeat(78),
  payload: { resource: "gameflow_session", data: {} },
});

test("resolves only an unambiguous verified observer platform", () => {
  const account = { puuid: "p".repeat(78), region: "AMERICA_NORTH" };
  expect(withObserverPlatform(observation, [account]).platformId).toBe("NA1");
  expect(
    withObserverPlatform(observation, [{ ...account, puuid: "other" }])
      .platformId,
  ).toBeUndefined();
  expect(
    withObserverPlatform(observation, [
      account,
      { ...account, region: "EU_WEST" },
    ]).platformId,
  ).toBeUndefined();
  expect(
    withObserverPlatform({ ...observation, platformId: "euw1" }, [account])
      .platformId,
  ).toBe("EUW1");
  expect(observation.platformId).toBeUndefined();
});
