import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  STORM_IMAGE_CONFIGS_PATH,
  PIN_STATE_FILE_REL,
  VERSION_CATALOG_FILE_REL,
  syncStormImageConfigs,
  writeVersionPinUpdate,
} from "./sync-storm-image-configs.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots.length = 0;
});
const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
function readEconomyConfig() {
  return Promise.resolve(
    new TextEncoder().encode("modules:\n  economy: true\n"),
  );
}
function catalog(candidate: string, prod: string) {
  return JSON.stringify({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: [
      {
        name: "shepherdjerred/the-storm-server",
        value: `2.0.0-1@sha256:${candidate}`,
      },
      {
        name: "shepherdjerred/the-storm-server/prod",
        value: `2.0.0-1@sha256:${prod}`,
      },
    ].map((entry) => ({
      ...entry,
      category: "internal-image",
      artifactType: "image",
      management: { managed: false },
    })),
  });
}
async function temporaryRoot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storm-pin-config-"));
  roots.push(dir);
  return dir;
}

test("captures both exact pins, reuses verified schemas and retires unpinned digests", async () => {
  const dir = await temporaryRoot();
  const read = vi.fn(async (digest: string) =>
    new TextEncoder().encode(
      `modules:\n  ${digest === `sha256:${a}` ? "economy" : "companions"}: true\n`,
    ),
  );
  await syncStormImageConfigs(dir, catalog(a, b), read);
  const file = Bun.file(path.join(dir, STORM_IMAGE_CONFIGS_PATH));
  const initial: unknown = await file.json();
  expect(initial).toMatchObject({
    [a]: { moduleKeys: ["economy"] },
    [b]: { moduleKeys: ["companions"] },
  });
  await syncStormImageConfigs(dir, catalog(c, b), read);
  expect(read.mock.calls.map(([digest]) => digest)).toEqual([
    `sha256:${a}`,
    `sha256:${b}`,
    `sha256:${c}`,
  ]);
  expect(Object.keys(await file.json())).toEqual([c, b]);
  await syncStormImageConfigs(dir, catalog(c, b), read);
  expect(read).toHaveBeenCalledTimes(3);
});

test("leaves existing snapshots intact if an exact image cannot be read", async () => {
  const dir = await temporaryRoot();
  await syncStormImageConfigs(dir, catalog(a, b), readEconomyConfig);
  const file = Bun.file(path.join(dir, STORM_IMAGE_CONFIGS_PATH));
  const before = await file.text();
  await expect(
    syncStormImageConfigs(dir, catalog(c, b), async () => {
      throw new Error("registry unavailable");
    }),
  ).rejects.toThrow(/registry unavailable/u);
  expect(await file.text()).toBe(before);
});

test("stages catalog, pin state and exact-image snapshots together", async () => {
  const dir = await temporaryRoot();
  const source = catalog(a, b);
  await syncStormImageConfigs(dir, source, readEconomyConfig);
  const staged: string[][] = [];
  await writeVersionPinUpdate(
    dir,
    source,
    "pin state fixture",
    async (args) => {
      expect(
        await Bun.file(path.join(dir, VERSION_CATALOG_FILE_REL)).text(),
      ).toBe(source);
      expect(await Bun.file(path.join(dir, PIN_STATE_FILE_REL)).text()).toBe(
        "pin state fixture",
      );
      expect(
        Object.keys(
          await Bun.file(path.join(dir, STORM_IMAGE_CONFIGS_PATH)).json(),
        ),
      ).toEqual([a, b]);
      staged.push(args);
    },
  );
  expect(staged).toEqual([
    [
      "add",
      VERSION_CATALOG_FILE_REL,
      PIN_STATE_FILE_REL,
      STORM_IMAGE_CONFIGS_PATH,
    ],
  ]);
});
