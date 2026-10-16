import { afterEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { excludedMediaFileNames } from "homelab/src/media-download-policy.ts";
import { App } from "cdk8s";
import { parse } from "yaml";
import { z } from "zod";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media/media.ts";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});
const configDir = path.join(import.meta.dir, "../configs/qbittorrent");
const desired = `[BitTorrent]\nExcludedFileNamesEnabled=true\nSession\\ExcludedFileNames=${excludedMediaFileNames}\n[Preferences]\nWebUI\\Username=jerred\n`;

async function migrate(live: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "media-safety-"));
  directories.push(dir);
  const seedPath = path.join(dir, "seed.conf");
  const livePath = path.join(dir, "live.conf");
  writeFileSync(seedPath, desired);
  writeFileSync(livePath, live);
  const proc = Bun.spawn(
    [
      "sh",
      path.join(configDir, "migrate-download-safety.sh"),
      seedPath,
      livePath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  await new Response(proc.stderr).text();
  return {
    code: await proc.exited,
    content: readFileSync(livePath, "utf8"),
    livePath,
    seedPath,
  };
}

test.each(["", "ExcludedFileNamesEnabled=false\n"])(
  "migrates only the known blank legacy policy (%s)",
  async (enabled) => {
    const result = await migrate(
      `[BitTorrent]\n${enabled}Session\\ExcludedFileNames=\n[Preferences]\nWebUI\\Username=jerred\nWebUI\\Password_PBKDF2=preserved\n`,
    );
    expect(result.code).toBe(0);
    expect(result.content).toContain(
      String.raw`Session\ExcludedFileNames=${excludedMediaFileNames}`,
    );
    expect(result.content).toContain(
      String.raw`WebUI\Password_PBKDF2=preserved`,
    );
    const guard = Bun.spawn(
      [
        "sh",
        path.join(configDir, "check-config-drift.sh"),
        result.seedPath,
        result.livePath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await guard.exited).toBe(0);
  },
);
test("the migration is idempotent", async () => {
  expect(await migrate(desired)).toMatchObject({ code: 0, content: desired });
});
test("unexpected exclusion changes fail without replacing the live file", async () => {
  const live = desired.replace(excludedMediaFileNames, "*.mkv");
  expect(await migrate(live)).toMatchObject({ code: 3, content: live });
});

test("the rendered client enables the shared policy and rolls when its configuration changes", async () => {
  const app = new App();
  await createMediaChart(app);
  const resources: unknown[] = app
    .synthYaml()
    .split(/^---$/mu)
    .filter((part) => part.trim() !== "")
    .map((part) => parse(part));
  const maps = resources.flatMap((resource) => {
    const result = z
      .object({
        kind: z.literal("ConfigMap"),
        metadata: z.object({ name: z.string() }),
        data: z.record(z.string(), z.string()),
      })
      .safeParse(resource);
    return result.success ? [result.data] : [];
  });
  const config = maps.find(
    (entry) => entry.metadata.name === "qbittorrent-config",
  )?.data["qBittorrent.conf"];
  expect(config).toContain("ExcludedFileNamesEnabled=true");
  expect(config).toContain(
    `${String.raw`Session\ExcludedFileNames`}=${excludedMediaFileNames}`,
  );
  const deployments = resources.flatMap((resource) => {
    const result = z
      .object({
        kind: z.literal("Deployment"),
        metadata: z.object({ name: z.string() }),
        spec: z.object({
          template: z.object({
            metadata: z.object({
              annotations: z.record(z.string(), z.string()).optional(),
            }),
          }),
        }),
      })
      .safeParse(resource);
    return result.success ? [result.data] : [];
  });
  const hash = deployments.find(
    (entry) => entry.metadata.name === "media-qbittorrent",
  )?.spec.template.metadata.annotations?.["sjer.red/qbittorrent-config-sha256"];
  expect(hash).toMatch(/^[a-f\d]{64}$/u);
});
