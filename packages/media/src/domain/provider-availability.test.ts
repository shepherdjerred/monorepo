import { expect, it } from "vitest";
import {
  nextProviderAvailability,
  observedProviderSeeders,
  PROVIDER_AVAILABILITY_MAX_AGE_MS,
} from "./provider-availability.ts";

const source = { providerId: "privatehd", providerReleaseId: "42", seeders: 1 };
const time = new Date("2026-11-13T00:00:00.000Z");
it("retains the latest actual seed count without rewriting an older source snapshot", () => {
  const first = nextProviderAvailability(
    null,
    { ...source, seeders: 0 },
    time,
  )!;
  const second = nextProviderAvailability(
    first,
    source,
    new Date(time.getTime() + 1),
  )!;
  expect(first.seeders).toBe(0);
  expect(second.seeders).toBe(1);
  expect(second.version).toBe(2);
  expect(
    nextProviderAvailability(second, { ...source, seeders: 0 }, time),
  ).toBeNull();
  expect(observedProviderSeeders(second, source, time.getTime() + 1)).toBe(1);
});
it("protects stale, future, and cross-source observations under the same freshness contract", () => {
  const observation = nextProviderAvailability(null, source, time)!;
  expect(
    observedProviderSeeders(
      observation,
      source,
      time.getTime() + PROVIDER_AVAILABILITY_MAX_AGE_MS + 1,
    ),
  ).toBeNull();
  expect(
    observedProviderSeeders(observation, source, time.getTime() - 1),
  ).toBeNull();
  expect(() =>
    observedProviderSeeders(
      observation,
      { ...source, providerReleaseId: "43" },
      time.getTime(),
    ),
  ).toThrow("another source identity");
  expect(() =>
    nextProviderAvailability(
      observation,
      { ...source, providerId: "animez" },
      new Date(time.getTime() + 1),
    ),
  ).toThrow("another source identity");
});
