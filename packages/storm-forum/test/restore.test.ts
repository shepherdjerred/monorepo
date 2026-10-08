import { describe, expect, it } from "vitest";
import { validateSnapshot } from "#src/restore.ts";
const owner = "f8d36d3a-e74e-4b28-a661-b03ed85c7e55";
const prefix = `snapshots/prod/${owner}`;
const sha = "a".repeat(64);
const runtimeImage = `ghcr.io/shepherdjerred/storm-forum@sha256:${sha}`;
const source = { bundleSha256: sha, xenforoVersion: "2.3.13", runtimeImage };
const snapshot = {
  schemaVersion: 1,
  stage: "prod",
  owner,
  xenforoVersion: "2.3.13",
  bundleSha256: sha,
  createdAt: "2026-10-03T18:00:00.000Z",
  payloads: ["database.sql", "files.tar.gz"].map((name) => ({
    key: `${prefix}/${name}`,
    sha256: sha,
    bytes: 128,
  })),
};
describe("coordinated restore contract", () => {
  it("accepts the committed pair for the exact private release", () => {
    expect(
      validateSnapshot(snapshot, `${prefix}/manifest.json`, source, source)
        .owner,
    ).toBe(owner);
  });
  it("refuses mixed releases, uncommitted keys and arbitrary object paths", () => {
    expect(() =>
      validateSnapshot(
        snapshot,
        `${prefix}/manifest.json`,
        { ...source, bundleSha256: "b".repeat(64) },
        source,
      ),
    ).toThrow();
    expect(() =>
      validateSnapshot(snapshot, "manifest.json", source, source),
    ).toThrow();
    expect(() =>
      validateSnapshot(
        snapshot,
        `${prefix}/manifest.json`,
        {
          ...source,
          runtimeImage: `ghcr.io/shepherdjerred/storm-forum@sha256:${"b".repeat(64)}`,
        },
        source,
      ),
    ).toThrow(/installed release/);
    expect(() =>
      validateSnapshot(snapshot, `${prefix}/manifest.json`, source, undefined),
    ).toThrow();
    expect(() =>
      validateSnapshot(
        {
          ...snapshot,
          payloads: snapshot.payloads.map((p) => ({
            ...p,
            key: "../database.sql",
          })),
        },
        `${prefix}/manifest.json`,
        source,
        source,
      ),
    ).toThrow();
  });
});
