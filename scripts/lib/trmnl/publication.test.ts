import { expect, test } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  TRMNL_PLUGIN_POLICY,
  parseTrmnlPluginBundle,
  validateTrmnlPluginSettings,
} from "@shepherdjerred/ops-model/trmnl/plugin-policy.ts";
import {
  buildTrmnlPluginArchive,
  trmnlArchiveArtifact,
  trmnlBackendDigest,
} from "./publication.ts";

test("actual reviewed source becomes an immutable package with exact backend requirement", async () => {
  const archive = await buildTrmnlPluginArchive(
    new URL("../../../packages/trmnl-dashboard/trmnl", import.meta.url)
      .pathname,
    "a".repeat(40),
  );
  validateTrmnlPluginSettings(parseTrmnlPluginBundle(archive.bytes), parseYaml);
  expect(archive.uri).toBe(
    `s3://delivery-artifacts/trmnl-plugins/${archive.digest.slice(7)}.json`,
  );
  expect(
    trmnlArchiveArtifact(archive, `sha256:${"b".repeat(64)}`, {
      repositoryId: "1",
      pipelineNumber: "22",
    }).requires,
  ).toEqual({ "image:trmnl-dashboard": `sha256:${"b".repeat(64)}` });
  expect(
    await trmnlBackendDigest(
      { "shepherdjerred/trmnl-dashboard": `sha256:${"b".repeat(64)}` },
      () => {
        throw new Error("Fresh image must not query historical artifacts");
      },
    ),
  ).toBe(`sha256:${"b".repeat(64)}`);
  await expect(
    trmnlBackendDigest({}, () => Promise.resolve({})),
  ).rejects.toThrow();
});
test("settings target mismatch is rejected before any publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "trmnl-package-test-"));
  try {
    for (const target of TRMNL_PLUGIN_POLICY.plugins) {
      const source = path.join(root, target.slug, "src");
      await mkdir(source, { recursive: true });
      for (const name of TRMNL_PLUGIN_POLICY.files)
        await Bun.write(
          path.join(source, name),
          name === "settings.yml" ? "id: 1\n" : "fixture",
        );
    }
    await expect(buildTrmnlPluginArchive(root, "a".repeat(40))).rejects.toThrow(
      /settings ID/u,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
