import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { BenchmarkResourcesSchema } from "../lib/ci/task-diagnostics.ts";
import { retainDiagnostics } from "./run-with-diagnostics.ts";
import { startBenchmarkResources } from "./benchmark-resources.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "benchmark-resources-"));
  directories.push(root);
  const cgroup = path.join(root, "cgroup");
  await mkdir(cgroup);
  const scratch: [string, string] = [
    path.join(root, "tmp"),
    path.join(root, "gradle"),
  ];
  await Promise.all(
    Object.entries({
      "memory.current": "100",
      "memory.peak": "200",
      "memory.max": "1000",
      "memory.events": "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n",
    }).map(async ([name, value]) => Bun.write(path.join(cgroup, name), value)),
  );
  return { cgroup, scratch };
}
test("retains initial and final lifetime counters and filesystem capacity", async () => {
  const locations = await fixture();
  const observer = await startBenchmarkResources("baseline", locations);
  await Bun.write(path.join(locations.cgroup, "memory.peak"), "800");
  await Bun.write(
    path.join(locations.cgroup, "memory.events"),
    "max 2\noom 1\noom_kill 1\n",
  );
  const report = BenchmarkResourcesSchema.parse(await observer.finish());
  expect(report.collectionFailed).toBe(false);
  expect(report.samples).toHaveLength(2);
  expect(report.samples[1]?.memory).toEqual({
    currentBytes: 100,
    peakBytes: 800,
    limitBytes: 1000,
    limitHits: 2,
    oomEvents: 1,
    oomKills: 1,
  });
  expect(report.samples[1]?.filesystems.map((fs) => fs.path)).toEqual([
    "/woodpecker/tmp",
    "/woodpecker/gradle",
  ]);
  expect(
    report.samples[1]?.filesystems.every(
      (fs) => fs.capacityBytes > 0 && fs.availableBytes <= fs.capacityBytes,
    ),
  ).toBe(true);
});
test("cannot accept a scratch candidate backed by ordinary directories", async () => {
  await expect(
    startBenchmarkResources("candidate", await fixture()),
  ).rejects.toThrow("two distinct tmpfs");
});
test.each(["memory.peak", "memory.events"])(
  "retains incomplete evidence when final %s is unreadable",
  async (name) => {
    const locations = await fixture();
    const observer = await startBenchmarkResources("baseline", locations);
    await rm(path.join(locations.cgroup, name));
    const report = await observer.finish();
    expect(report.collectionFailed).toBe(true);
    expect(report.samples).toHaveLength(1);
  },
);
test("rejects counter resets instead of declaring a clean memory lifetime", async () => {
  const locations = await fixture();
  const observer = await startBenchmarkResources("baseline", locations);
  await Bun.write(path.join(locations.cgroup, "memory.peak"), "1");
  const report = await observer.finish();
  expect(report.collectionFailed).toBe(true);
  expect(report.samples).toHaveLength(1);
});

test.each([0, 42])(
  "incomplete resource evidence gates successful tasks and preserves failure %i",
  async (exitCode) => {
    const locations = await fixture();
    const observer = await startBenchmarkResources("baseline", locations);
    await rm(path.join(locations.cgroup, "memory.events"));
    const benchmarkResources = await observer.finish();
    let published: unknown;
    const result = await retainDiagnostics(
      {
        version: 1,
        pipeline: "123",
        commit: "a".repeat(40),
        workflow: "verify",
        startedAt: 100,
        finishedAt: 200,
        exitCode,
        benchmarkResources,
      },
      new Set(),
      path.dirname(locations.cgroup),
      async (report) => {
        published = report;
      },
    );
    expect(result).toBe(exitCode === 0 ? 1 : exitCode);
    expect(published).toMatchObject({
      exitCode,
      benchmarkResources: {
        collectionFailed: true,
        samples: [
          expect.objectContaining({
            memory: {
              currentBytes: 100,
              peakBytes: 200,
              limitBytes: 1000,
              limitHits: 0,
              oomEvents: 0,
              oomKills: 0,
            },
          }),
        ],
      },
    });
  },
);
