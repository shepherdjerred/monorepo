import { describe, expect, test } from "vitest";
import {
  compareInstalls,
  type InstallSnapshot,
  type OptionalPeerLookup,
  storeEntryId,
  unbaselinedOptionalPeers,
} from "./install-drift.ts";

type Entries = Record<string, Record<string, string>>;

function install(
  entries: Entries,
  roots: Record<string, Record<string, string>>,
): InstallSnapshot {
  return {
    entries: new Map(
      Object.entries(entries).map(([entry, links]) => [
        entry,
        { id: storeEntryId(entry), links: new Map(Object.entries(links)) },
      ]),
    ),
    roots: new Map(
      Object.entries(roots).map(([dir, links]) => [
        dir,
        new Map(Object.entries(links)),
      ]),
    ),
  };
}

// debug's supports-color and app's webpack are optional peers.
const optionalPeer: OptionalPeerLookup = (id, dependency) =>
  (id.startsWith("debug@") && dependency === "supports-color") ||
  (id === "workspace:packages/app" && dependency === "webpack");

const today = install(
  {
    "debug@4.4.3+0000000000000001": {
      ms: "ms@2.1.3",
      "supports-color": "supports-color@8.1.1",
    },
    "ms@2.1.3": {},
    "supports-color@8.1.1": {},
    "webpack@5.0.0": { "@scope+tool@1.0.0": "@scope+tool@1.0.0" },
    "@scope+tool@1.0.0": {},
  },
  {
    "packages/app": {
      debug: "debug@4.4.3+0000000000000001",
      webpack: "webpack@5.0.0",
    },
  },
);

describe("storeEntryId", () => {
  test("reads the package id out of an isolated store entry", () => {
    expect(storeEntryId("@scope+tool@1.0.0+0123456789abcdef")).toBe(
      "@scope/tool@1.0.0",
    );
    expect(storeEntryId("ms@2.1.3")).toBe("ms@2.1.3");
    expect(() => storeEntryId("node_modules")).toThrow(
      "not an isolated store entry",
    );
  });
});

describe("compareInstalls", () => {
  test("accepts dropped optional peers and the allowlisted debug binding", () => {
    const projected = install(
      {
        "debug@4.4.3+0000000000000002": {
          ms: "ms@2.1.3",
          "supports-color": "supports-color@7.2.0",
        },
        "ms@2.1.3": {},
        "supports-color@7.2.0": {},
      },
      { "packages/app": { debug: "debug@4.4.3+0000000000000002" } },
    );
    const report = compareInstalls(today, projected, optionalPeer);
    expect(report.removed).toEqual([
      "@scope/tool@1.0.0",
      "supports-color@8.1.1",
      "webpack@5.0.0",
    ]);
    expect(report.added).toEqual(["supports-color@7.2.0"]);
    expect(report.optionalPeerChanges).toEqual([
      { dependent: "debug", peer: "supports-color", change: "rebind" },
      { dependent: "workspace:packages/app", peer: "webpack", change: "drop" },
    ]);
    expect(report.violations).toEqual([]);
  });

  test("fails an optional-peer change the audited baseline does not list", () => {
    const changes = [
      { dependent: "debug", peer: "supports-color", change: "rebind" },
      { dependent: "vite", peer: "sass", change: "drop" },
    ] as const;
    const baseline = [
      {
        dependent: "debug",
        peer: "supports-color",
        change: "rebind",
        reason: "color support only",
        installs: ["packages/app --filter app"],
      },
    ] as const;
    expect(
      unbaselinedOptionalPeers("packages/app --filter app", changes, baseline),
    ).toEqual([
      "vite's optional peer sass is dropped, and optional-peer-baseline.json does not list it for this install. Audit the runtime load path: if shipped code loads sass, declare it as a dependency of the workspace that loads it; otherwise add the entry with a one-line reason.",
    ]);
    // A baseline entry covers only the installs it names.
    expect(
      unbaselinedOptionalPeers(
        "packages/other --filter other",
        changes,
        baseline,
      ),
    ).toHaveLength(2);
  });

  test("fails a version only the projection installs", () => {
    const projected = install(
      {
        "debug@4.4.3": { ms: "ms@3.0.0" },
        "ms@3.0.0": {},
      },
      { "packages/app": { debug: "debug@4.4.3" } },
    );
    expect(compareInstalls(today, projected, optionalPeer).violations).toEqual([
      "ms@2.1.3 is removed but today reaches it as a required dependency",
      "ms@3.0.0 is installed only by the projection",
      "debug@4.4.3 links ms to ms@3.0.0 (today ms@2.1.3)",
    ]);
  });

  test("fails an allowlisted version reached through a required edge", () => {
    const projected = install(
      {
        "debug@4.4.3": { ms: "ms@2.1.3" },
        "ms@2.1.3": { "supports-color": "supports-color@7.2.0" },
        "supports-color@7.2.0": {},
      },
      { "packages/app": { debug: "debug@4.4.3" } },
    );
    expect(compareInstalls(today, projected, optionalPeer).violations).toEqual([
      "supports-color@7.2.0 is installed only by the projection",
      "ms@2.1.3 links supports-color to supports-color@7.2.0 (today nothing)",
    ]);
  });

  test("fails a removed package that today reaches as a required dependency", () => {
    const projected = install(
      { "debug@4.4.3": {} },
      { "packages/app": { debug: "debug@4.4.3" } },
    );
    expect(compareInstalls(today, projected, optionalPeer).violations).toEqual([
      "ms@2.1.3 is removed but today reaches it as a required dependency",
      "debug@4.4.3 links ms to nothing (today ms@2.1.3)",
    ]);
  });
});
