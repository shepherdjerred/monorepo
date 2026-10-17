import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { preparePlan } from "#automation/plex-exclusion/evidence.ts";
import {
  cleanupExclusionProbe,
  prepareProbeVideo,
  readExclusionMarkers,
  stageExclusionProbe,
} from "./plex-exclusion-probe.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const libraryRoot = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "media-exclusion-test-")),
  );
  directories.push(libraryRoot);
  const runId = crypto.randomUUID();
  const journal = await prepareProbeVideo(runId);
  const plan = preparePlan({
    runId,
    libraryRoot,
    recoveryEpoch: 1,
    runtimeVersion: 1,
    topology: {
      serverMachineId: "fixture",
      serverVersion: "1.43",
      sectionId: "1",
      sectionUuid: "section",
      kind: "movie",
      scanner: "Plex Movie",
      agent: "plex",
      locations: [libraryRoot],
      scannedAt: 1,
      refreshing: false,
    },
    ...(await readExclusionMarkers(libraryRoot)),
  });
  return { plan, journal };
}

test("stages real valid identical probes, resumes committed journal and cleans only owned files", async () => {
  const f = await fixture();
  let journal = f.journal;
  const guard = {
    authorize: () => Promise.resolve(),
    checkpoint: () => Promise.resolve(),
    save: async (value: typeof journal) => {
      journal = value;
    },
  };
  const staged = await stageExclusionProbe(f.plan, journal, guard);
  expect(staged.stagedAt).not.toBeNull();
  expect(await readFile(f.plan.positivePath)).toEqual(
    await readFile(f.plan.negativePath),
  );
  expect(
    await readFile(nodePath.join(f.plan.libraryRoot, ".plexignore"), "utf8"),
  ).toBe(".media-control/*\n");
  expect(await stageExclusionProbe(f.plan, staged, guard)).toEqual(staged);
  const unrelated = nodePath.join(f.plan.libraryRoot, "keep.mkv");
  await writeFile(unrelated, "unrelated");
  const cleaned = await cleanupExclusionProbe(f.plan, staged, guard);
  expect(cleaned.cleanedAt).not.toBeNull();
  await expect(readFile(f.plan.positivePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(unrelated, "utf8")).toBe("unrelated");
  expect(await cleanupExclusionProbe(f.plan, cleaned, guard)).toEqual(cleaned);
}, 15_000);

test("marker drift and changed probe content stop publication and cleanup", async () => {
  const f = await fixture();
  let journal = f.journal;
  const guard = {
    authorize: () => Promise.resolve(),
    checkpoint: () => Promise.resolve(),
    save: async (value: typeof journal) => {
      journal = value;
    },
  };
  await writeFile(
    nodePath.join(f.plan.libraryRoot, ".plexignore"),
    "changed\n",
  );
  await expect(stageExclusionProbe(f.plan, journal, guard)).rejects.toThrow(
    "marker changed",
  );
  await rm(nodePath.join(f.plan.libraryRoot, ".plexignore"));
  await stageExclusionProbe(f.plan, journal, guard);
  await writeFile(f.plan.positivePath, "changed");
  await expect(cleanupExclusionProbe(f.plan, journal, guard)).rejects.toThrow(
    "content changed",
  );
  expect(await readFile(f.plan.positivePath, "utf8")).toBe("changed");
}, 15_000);

test("authority revoked after durable creation intent prevents probe writes", async () => {
  const f = await fixture();
  let revoked = false;
  await expect(
    stageExclusionProbe(f.plan, f.journal, {
      authorize: async () => {
        if (revoked) throw new Error("epoch changed");
      },
      checkpoint: () => Promise.resolve(),
      save: async (value) => {
        if (value.positiveIntent) revoked = true;
      },
    }),
  ).rejects.toThrow("epoch changed");
  await expect(readFile(f.plan.positivePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
}, 15_000);

test("process death after the first probe recovers from the local durable journal", async () => {
  const f = await fixture();
  const input = nodePath.join(f.plan.libraryRoot, "fixture.json");
  await writeFile(input, JSON.stringify(f));
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("fixtures/exclusion-crash.ts", import.meta.url)),
      input,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await child.exited;
  expect(code).not.toBe(0);
  expect(await readFile(f.plan.positivePath)).toEqual(
    Buffer.from(f.journal.videoBase64, "base64"),
  );
  let recovered = f.journal;
  const result = await stageExclusionProbe(f.plan, f.journal, {
    authorize: () => Promise.resolve(),
    checkpoint: () => Promise.resolve(),
    save: (value) => {
      recovered = value;
      return Promise.resolve();
    },
  });
  expect(result.positive).not.toBeNull();
  expect(result.negative).not.toBeNull();
  expect(recovered.stagedAt).not.toBeNull();
}, 15_000);
