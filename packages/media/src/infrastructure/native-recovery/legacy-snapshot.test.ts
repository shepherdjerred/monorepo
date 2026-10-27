import { expect, test } from "vitest";
import {
  historicalDefaultIntent,
  historicalDefaultRow,
} from "./legacy-snapshot.ts";
import { snapshotHash } from "#migration/profile-import.ts";

test("old household receipt rows retain their exact JSON and canonical hash after key migration", () => {
  const original = {
    id: "claim",
    mediaId: "media",
    userId: "person",
    active: true,
    sourceVersion: 7,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  const migrated = { ...original, edition: "default" };
  expect(JSON.stringify(historicalDefaultRow(migrated))).toBe(
    JSON.stringify(original),
  );
  expect(snapshotHash(historicalDefaultRow(migrated))).toBe(
    snapshotHash(original),
  );
  expect(() =>
    historicalDefaultRow({ ...migrated, edition: "named" }),
  ).toThrow();
});

test("new target availability and root never enter historical intent evidence", () => {
  const original = {
    mediaId: "media",
    desiredPresence: true,
    generation: 4,
    version: 8,
    automationEpoch: 2,
    profileId: null,
  };
  const migrated = {
    ...original,
    edition: "default",
    editionRootId: "root",
    availability: "available",
    libraryMonitoring: true,
  };
  expect(JSON.stringify(historicalDefaultIntent(migrated))).toBe(
    JSON.stringify(original),
  );
  expect(snapshotHash(historicalDefaultIntent(migrated))).toBe(
    snapshotHash(original),
  );
  expect(historicalDefaultIntent({ ...migrated, editionRootId: null })).toEqual(
    original,
  );
});
