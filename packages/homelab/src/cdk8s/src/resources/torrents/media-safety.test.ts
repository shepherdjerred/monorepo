import { afterEach, expect, test } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { excludedMediaFileNames } from "homelab/src/media-download-policy.ts";
import { ApiObject, App } from "cdk8s";
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
  return applyMigration(seedPath, livePath);
}

async function applyMigration(seedPath: string, livePath: string) {
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
  const first = await migrate(desired);
  expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
    code: 0,
    content: desired,
  });
  for (const file of [first.livePath, `${first.livePath}.managed-exclusions`]) {
    expect(statSync(file).mode & 0o777).toBe(0o600);
  }
});

test("a previously managed enable setting cannot be silently disabled", async () => {
  const first = await migrate(desired);
  const edited = desired.replace(
    "ExcludedFileNamesEnabled=true",
    "ExcludedFileNamesEnabled=false",
  );
  writeFileSync(first.livePath, edited);
  expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
    code: 3,
    content: edited,
  });
});
test("unexpected exclusion changes fail without replacing the live file", async () => {
  const live = desired.replace(excludedMediaFileNames, "*.mkv");
  expect(await migrate(live)).toMatchObject({ code: 3, content: live });
});

test("fresh protected configurations record the receipt needed by a later policy upgrade", async () => {
  const first = await migrate(desired);
  const upgraded = desired.replace(
    excludedMediaFileNames,
    `${excludedMediaFileNames}, *.future`,
  );
  writeFileSync(first.seedPath, upgraded);
  expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
    code: 0,
    content: upgraded,
  });
  expect(readFileSync(`${first.livePath}.managed-exclusions`, "utf8")).toBe(
    `${excludedMediaFileNames}, *.future\n`,
  );
  writeFileSync(first.seedPath, desired);
  expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
    code: 0,
    content: desired,
  });
});

test.each(["*.mkv", ""])(
  "a managed policy edited to %j is not overwritten",
  async (value) => {
    const first = await migrate(desired);
    const edited = desired.replace(excludedMediaFileNames, value);
    writeFileSync(first.livePath, edited);
    expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
      code: 3,
      content: edited,
    });
  },
);

test("an interrupted receipt update is recovered without losing unrelated configuration", async () => {
  const first = await migrate(desired);
  const upgraded = desired.replace(
    excludedMediaFileNames,
    `${excludedMediaFileNames}, *.future`,
  );
  writeFileSync(first.seedPath, upgraded);
  writeFileSync(
    first.livePath,
    `${upgraded}WebUI\\Password_PBKDF2=preserved\n`,
  );
  expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
    code: 0,
    content: `${upgraded}WebUI\\Password_PBKDF2=preserved\n`,
  });
  expect(readFileSync(`${first.livePath}.managed-exclusions`, "utf8")).toBe(
    `${excludedMediaFileNames}, *.future\n`,
  );
});

test.each(["", "*.exe\n*.bat\n"])(
  "corrupt receipts fail without changing the live configuration (%j)",
  async (receipt) => {
    const first = await migrate(desired);
    writeFileSync(`${first.livePath}.managed-exclusions`, receipt);
    expect(await applyMigration(first.seedPath, first.livePath)).toMatchObject({
      code: 3,
      content: desired,
    });
  },
);

test("the rendered client enables the shared policy and rolls when its configuration changes", async () => {
  const app = new App();
  await createMediaChart(app);
  const resources = app.node
    .findAll()
    .filter((node) => ApiObject.isApiObject(node));
  function rendered(kind: string, name: string): unknown {
    const resource = resources.find(
      (entry) => entry.kind === kind && entry.name === name,
    );
    if (resource === undefined) throw new Error(`Missing ${kind} ${name}`);
    return resource.toJson();
  }
  const config = z
    .object({ data: z.record(z.string(), z.string()) })
    .parse(rendered("ConfigMap", "qbittorrent-config")).data[
    "qBittorrent.conf"
  ];
  expect(config).toContain("ExcludedFileNamesEnabled=true");
  expect(config).toContain(
    `${String.raw`Session\ExcludedFileNames`}=${excludedMediaFileNames}`,
  );
  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          metadata: z.object({
            annotations: z.record(z.string(), z.string()),
          }),
        }),
      }),
    })
    .parse(rendered("Deployment", "media-qbittorrent"));
  const hash =
    deployment.spec.template.metadata.annotations[
      "sjer.red/qbittorrent-config-sha256"
    ];
  expect(hash).toMatch(/^[a-f\d]{64}$/u);
});
