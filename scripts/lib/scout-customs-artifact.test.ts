import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertScoutCustomsArtifactPolicy } from "./scout-customs-artifact.ts";

const directories: string[] = [];

async function temporarySite(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-customs-site-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Scout Customs release artifact policy", () => {
  test("requires a real Customs entrypoint in beta", async () => {
    const site = await temporarySite();
    await expect(
      assertScoutCustomsArtifactPolicy(site, "beta"),
    ).rejects.toThrow("missing customs/index.html");
    await mkdir(path.join(site, "customs"));
    await Bun.write(path.join(site, "customs/index.html"), "x".repeat(101));
    await expect(
      assertScoutCustomsArtifactPolicy(site, "beta"),
    ).resolves.toBeUndefined();
  });

  test("rejects a Customs entrypoint in production", async () => {
    const site = await temporarySite();
    await expect(
      assertScoutCustomsArtifactPolicy(site, "prod"),
    ).resolves.toBeUndefined();
    await mkdir(path.join(site, "customs"));
    await Bun.write(path.join(site, "customs/index.html"), "x".repeat(101));
    await expect(
      assertScoutCustomsArtifactPolicy(site, "prod"),
    ).rejects.toThrow("forbidden Customs UI");
  });
});
