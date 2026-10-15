import { describe, expect, it } from "vitest";
import { validateSnapshot } from "#src/restore.ts";
import { validateBackupSource } from "#src/release.ts";
import { RuntimeImageSchema } from "#src/storage.ts";
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
  it("records Docker Hub images and restores legacy records only at the same digest", () => {
    const migrated = {
      ...source,
      runtimeImage: runtimeImage.replace("ghcr.io/", "docker.io/"),
    };
    expect(validateBackupSource(migrated, source.xenforoVersion)).toEqual(
      migrated,
    );
    expect(
      validateSnapshot(snapshot, `${prefix}/manifest.json`, migrated, migrated)
        .owner,
    ).toBe(owner);
    expect(
      validateSnapshot(snapshot, `${prefix}/manifest.json`, migrated, source)
        .owner,
    ).toBe(owner);
    expect(() =>
      validateSnapshot(
        snapshot,
        `${prefix}/manifest.json`,
        {
          ...migrated,
          runtimeImage: migrated.runtimeImage.replace(sha, "b".repeat(64)),
        },
        source,
      ),
    ).toThrow(/installed release/);
    for (const image of [
      migrated.runtimeImage.replace("docker.io/", "example.com/"),
      migrated.runtimeImage.replace("storm-forum@", "other-forum@"),
      "docker.io/shepherdjerred/storm-forum:latest",
    ])
      expect(RuntimeImageSchema.safeParse(image).success).toBe(false);
  });
  it("rejects stale source-version metadata before committing a snapshot", () => {
    expect(validateBackupSource(source, source.xenforoVersion)).toEqual(source);
    expect(() =>
      validateBackupSource(
        { ...source, xenforoVersion: "2.3.8" },
        source.xenforoVersion,
      ),
    ).toThrow(/installed database/);
  });
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
