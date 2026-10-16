import { mkdir, stat, statfs } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import type { BenchmarkResources } from "../lib/ci/task-diagnostics.ts";

const TMPFS_MAGIC = 0x01_02_19_94;
const INTERVAL_MS = 10_000;
const MAX_PERIODIC_SAMPLES = 720;
const SCRATCH_PATHS = ["/woodpecker/tmp", "/woodpecker/gradle"] as const;
const RESOURCE_LOCATIONS = { cgroup: "/sys/fs/cgroup", scratch: SCRATCH_PATHS };

function integer(text: string): number {
  const value = Number(text.trim());
  if (!/^\d+$/u.test(text.trim()) || !Number.isSafeInteger(value))
    throw new Error("Invalid benchmark resource counter");
  return value;
}

async function memory(cgroup: string) {
  const [current, peak, limit, events] = await Promise.all(
    ["memory.current", "memory.peak", "memory.max", "memory.events"].map(
      async (name) => Bun.file(path.join(cgroup, name)).text(),
    ),
  );
  if (
    current === undefined ||
    peak === undefined ||
    limit === undefined ||
    events === undefined
  )
    throw new Error("Missing benchmark memory counters");
  const counters = new Map(
    events
      .trim()
      .split("\n")
      .map((line) => {
        const [name, value] = line.trim().split(/\s+/u);
        if (name === undefined || value === undefined)
          throw new Error("Invalid benchmark memory events");
        return [name, integer(value)];
      }),
  );
  const max = counters.get("max"),
    oom = counters.get("oom"),
    oomKill = counters.get("oom_kill");
  if (max === undefined || oom === undefined || oomKill === undefined)
    throw new Error("Missing benchmark memory events");
  return {
    currentBytes: integer(current),
    peakBytes: integer(peak),
    limitBytes: integer(limit),
    limitHits: max,
    oomEvents: oom,
    oomKills: oomKill,
  };
}

/** Built-ins only: this starts before the child installs workspace packages. */
export async function startBenchmarkResources(
  variant: "baseline" | "candidate",
  locations: {
    cgroup: string;
    scratch: readonly [string, string];
  } = RESOURCE_LOCATIONS,
) {
  await Promise.all(
    locations.scratch.map(async (directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
  const devices = await Promise.all(
    locations.scratch.map(async (directory) => stat(directory)),
  );
  const samples: BenchmarkResources["samples"] = [];
  let collectionFailed = false;
  async function sample() {
    const [usage, filesystems] = await Promise.all([
      memory(locations.cgroup),
      Promise.all(
        locations.scratch.map(async (directory, index) => {
          const fs = await statfs(directory);
          const scratchPath = SCRATCH_PATHS[index];
          if (scratchPath === undefined)
            throw new Error("Unexpected benchmark scratch path");
          const capacityBytes = fs.blocks * fs.bsize;
          const usedBytes = (fs.blocks - fs.bfree) * fs.bsize;
          const availableBytes = fs.bavail * fs.bsize;
          if (
            ![capacityBytes, usedBytes, availableBytes].every(
              (value) => Number.isSafeInteger(value) && value >= 0,
            )
          )
            throw new Error("Invalid benchmark filesystem counters");
          // Disk baselines report shared filesystem capacity, never directory size.
          return {
            path: scratchPath,
            filesystem:
              fs.type === TMPFS_MAGIC
                ? ("tmpfs" as const)
                : ("shared" as const),
            capacityBytes,
            usedBytes,
            availableBytes,
          };
        }),
      ),
    ]);
    if (
      variant === "candidate" &&
      (filesystems.some((fs) => fs.filesystem !== "tmpfs") ||
        devices[0]?.dev === devices[1]?.dev)
    )
      throw new Error("Candidate benchmark requires two distinct tmpfs mounts");
    const previous = samples.at(-1)?.memory;
    if (
      previous !== undefined &&
      (usage.peakBytes < previous.peakBytes ||
        usage.limitHits < previous.limitHits ||
        usage.oomEvents < previous.oomEvents ||
        usage.oomKills < previous.oomKills ||
        usage.limitBytes !== previous.limitBytes)
    )
      throw new Error("Benchmark memory counter identity changed");
    samples.push({ at: Date.now(), memory: usage, filesystems });
  }
  await sample();
  const abort = new AbortController();
  const polling = (async () => {
    while (samples.length < MAX_PERIODIC_SAMPLES) {
      try {
        await setTimeout(INTERVAL_MS, undefined, { signal: abort.signal });
      } catch {
        if (!abort.signal.aborted) collectionFailed = true;
        return;
      }
      try {
        await sample();
      } catch {
        collectionFailed = true;
        return;
      }
    }
    collectionFailed = true;
  })();
  let finished: Promise<BenchmarkResources> | undefined;
  return {
    finish(): Promise<BenchmarkResources> {
      finished ??= (async () => {
        abort.abort();
        await polling;
        try {
          await sample();
        } catch {
          collectionFailed = true;
        }
        return {
          version: 1,
          variant,
          intervalMs: INTERVAL_MS,
          collectionFailed,
          samples,
        };
      })();
      return finished;
    },
  };
}
