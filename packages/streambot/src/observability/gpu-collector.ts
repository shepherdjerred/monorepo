/**
 * Per-pod GPU attribution by polling `/proc/<pid>/fdinfo/*` for i915 DRM fds and accumulating their
 * `drm-engine-<engine>:` nanosecond counters into the `streambot_gpu_engine_seconds_total` Counter.
 *
 * On Intel UHD Raptor Lake-S (Gen 12.2 / 8086:A780) — the silicon under streambot's homelab
 * deployment — `intel_gpu_top` always reports 0 % on the Video engine due to a known i915 PMU bug
 * ([Frigate#16619](https://github.com/blakeblackshear/frigate/discussions/16619),
 * [intel/media-driver#1376](https://github.com/intel/media-driver/issues/1376)). fdinfo is the
 * canonical workaround — the counters are kernel-direct, never wrong, and stable since Linux 5.19
 * (see kernel.org/doc/html/latest/gpu/drm-usage-stats.html).
 *
 * Per-pod attribution: `/dev/dri/renderD128` is shared with Plex and Jellyfin tenants on the same
 * node. `/proc` inside a container only exposes the container's PID namespace, so walking it from the
 * bun process naturally sums only THIS pod's engine time — no host-level join required.
 *
 * Counter semantics: per-fd counters are monotonic until the fd closes. Across ffmpeg respawns the
 * fd number reappears at zero, so we track the previous value per (pid, fd) tuple and only increment
 * the Counter by positive deltas. When an fd disappears, its tracking entry is dropped.
 */

import { readdir, readFile } from "node:fs/promises";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { gpuEngineSecondsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";

const log = logger.child("gpu-collector");

const ENGINES = ["render", "video", "copy"] as const;
type Engine = (typeof ENGINES)[number];

type EngineSnapshot = Record<Engine, number>;

function emptySnapshot(): EngineSnapshot {
  return { render: 0, video: 0, copy: 0 };
}

function parseEngineNanos(content: string, engine: Engine): number {
  // Format: `drm-engine-<engine>:\t<value> ns`
  const match = new RegExp(
    String.raw`^drm-engine-${engine}:\s+(\d+)\s+ns`,
    "m",
  ).exec(content);
  if (match === null) return 0;
  const raw = match[1];
  if (raw === undefined) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * One scrape pass over `/proc/PID/fdinfo/*`. Exported for tests.
 */
export async function scrapeGpuFdinfoOnce(
  state: Map<string, EngineSnapshot>,
  procRoot = "/proc",
): Promise<void> {
  let pids: string[];
  try {
    pids = await readdir(procRoot);
  } catch (error) {
    log.warn("failed to readdir /proc", { err: error });
    return;
  }

  const seen = new Set<string>();

  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    const fdinfoDir = `${procRoot}/${pid}/fdinfo`;
    let fds: string[];
    try {
      fds = await readdir(fdinfoDir);
    } catch {
      // Process disappeared between readdir and now, or we lack permission.
      continue;
    }

    for (const fd of fds) {
      if (!/^\d+$/.test(fd)) continue;
      const path = `${fdinfoDir}/${fd}`;
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        continue;
      }
      if (!content.includes("drm-driver:\ti915")) continue;

      seen.add(path);
      const previous = state.get(path) ?? emptySnapshot();
      const next = emptySnapshot();

      for (const engine of ENGINES) {
        const current = parseEngineNanos(content, engine);
        next[engine] = current;
        const delta = current - previous[engine];
        if (delta > 0) {
          gpuEngineSecondsTotal.inc({ engine }, delta / 1e9);
        }
      }

      state.set(path, next);
    }
  }

  // Drop tracking for fds that no longer exist; their next reappearance starts at zero.
  for (const path of state.keys()) {
    if (!seen.has(path)) state.delete(path);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | undefined;

/**
 * Start the periodic GPU fdinfo scraper. Idempotent — calling twice without {@link stopGpuCollector}
 * in between is a programmer error and throws. `intervalMs` defaults to 5 s, well below typical
 * Prometheus scrape intervals so per-fd deltas don't aggregate so much that an fd-close loses data.
 */
export function startGpuCollector(intervalMs = 5000): void {
  if (intervalHandle !== undefined) {
    throw new Error("GPU collector already started");
  }
  const state = new Map<string, EngineSnapshot>();
  intervalHandle = setInterval(() => {
    void (async () => {
      try {
        await scrapeGpuFdinfoOnce(state);
      } catch (error) {
        log.warn("scrape pass threw", { err: error });
      }
    })();
  }, intervalMs);
  // `unref` lets the process exit cleanly without waiting for this timer.
  intervalHandle.unref();
  log.info("GPU collector started", { intervalMs });
}

export function stopGpuCollector(): void {
  if (intervalHandle === undefined) return;
  clearInterval(intervalHandle);
  intervalHandle = undefined;
}
