import { expect, test } from "vitest";
import {
  ReplayRenderPackageInventorySchema,
  ReplayRenderPackageManifestSchema,
} from "./replay-support.ts";

const digest = "ab".repeat(32);
const inventory = {
  schemaVersion: 1,
  gameBuild: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  entrypoint: "engine.mjs",
  files: [{ path: "engine.mjs", bytes: 12, sha256: digest }],
};
const rift = {
  mapId: 11,
  gameMode: "CLASSIC",
  teamSizes: [5, 5],
};
const publicManifest = {
  ...inventory,
  capabilities: {
    ...rift,
    rosterCoverage: "all-legal-lineups-and-skins",
    rosterInventorySha256: digest,
  },
};

test("public manifests require full roster coverage", () => {
  expect(ReplayRenderPackageInventorySchema.parse(inventory)).toEqual(
    inventory,
  );
  expect(ReplayRenderPackageManifestSchema.parse(publicManifest)).toEqual(
    publicManifest,
  );
  expect(
    ReplayRenderPackageManifestSchema.safeParse({
      ...inventory,
      capabilities: {
        ...rift,
        rosterCoverage: "recorded-replay",
        replaySha256: digest,
      },
    }).success,
  ).toBe(false);
});

test("public manifests require a closed, unique file inventory", () => {
  expect(
    ReplayRenderPackageManifestSchema.safeParse({
      ...publicManifest,
      entrypoint: "undeclared.mjs",
    }).success,
  ).toBe(false);
  expect(
    ReplayRenderPackageManifestSchema.safeParse({
      ...publicManifest,
      files: [...inventory.files, ...inventory.files],
    }).success,
  ).toBe(false);
});
