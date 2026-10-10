import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { PaperMapOwner } from "./owner.ts";
import { TrainingMaps } from "./plan.ts";

const plan = TrainingMaps.parse({
  schema: 1,
  kind: "rwf-training-maps",
  maps: ["isles", "yard"].map((map) => ({
    map,
    blocksSha256: "a".repeat(64),
    scenarioSha256: "b".repeat(64),
  })),
});
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "rwf-map-owner-"));
  directories.push(directory);
  const events: string[] = [];
  let phase = "LOBBY";
  let failOpen = false;
  let failStop = false;
  const owner = new PaperMapOwner(plan, directory, async (_output, map) => {
    events.push(`open ${map}`);
    if (failOpen) throw new Error("boot failed");
    return {
      duels: {
        command: async () => ({
          phase,
          result: phase === "LIVE" ? "live" : "waiting",
        }),
      },
      stop: async () => {
        events.push(`stop ${map}`);
        if (failStop) throw new Error("cleanup failed");
      },
    };
  });
  return {
    owner,
    events,
    phase: (next: string) => {
      phase = next;
    },
    failOpen: () => {
      failOpen = true;
    },
    failStop: (value: boolean) => {
      failStop = value;
    },
  };
}

test("switches maps only after closing the old server and keeps repeated selection idempotent", async () => {
  const f = await fixture();
  expect(await f.owner.select("isles")).toEqual(plan.maps[0]);
  await f.owner.select("isles");
  await f.owner.select("yard");
  await f.owner.stop();
  expect(f.events).toEqual([
    "open isles",
    "stop isles",
    "open yard",
    "stop yard",
  ]);
  expect(() => f.owner.owner).toThrow("No Paper");
});

test("rejects unknown maps and live/resetting changes without stopping or replacing the owner", async () => {
  const f = await fixture();
  await f.owner.select("isles");
  const original = f.owner.owner;
  await expect(f.owner.select("not-admitted")).rejects.toThrow("frozen");
  for (const phase of ["LIVE", "RESETTING"]) {
    f.phase(phase);
    await expect(f.owner.select("yard")).rejects.toThrow("finish resetting");
  }
  expect(f.owner.owner).toBe(original);
  expect(f.events).toEqual(["open isles"]);
  await f.owner.stop();
});

test("a failed boot leaves no old server alive and failed cleanup retains its handle for outer cleanup", async () => {
  const f = await fixture();
  await f.owner.select("isles");
  f.failStop(true);
  await expect(f.owner.select("yard")).rejects.toThrow("cleanup failed");
  expect(f.owner.binding.map).toBe("isles");
  expect(f.events).toEqual(["open isles", "stop isles"]);
  f.failStop(false);
  f.failOpen();
  await expect(f.owner.select("yard")).rejects.toThrow("boot failed");
  expect(f.events).toEqual([
    "open isles",
    "stop isles",
    "stop isles",
    "open yard",
  ]);
  expect(() => f.owner.owner).toThrow("No Paper");
  await f.owner.stop();
});
