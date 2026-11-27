import path from "node:path";
import { handleHistoryApiRequest } from "@shepherdjerred/toolkit/lib/history/api/handler.ts";
import { CaptureArchiveReader } from "@shepherdjerred/toolkit/lib/history/captures/archive-reader.ts";
import { HistoryIndex } from "@shepherdjerred/toolkit/lib/history/index.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
} from "@shepherdjerred/toolkit/lib/history/paths.ts";
import { scanHistorySources } from "@shepherdjerred/toolkit/lib/history/scan.ts";
import { createHistorySources } from "@shepherdjerred/toolkit/lib/history/sources.ts";
import { targetedMessages } from "@shepherdjerred/toolkit/lib/history/targeted.ts";
import type { UsageSnapshot } from "@shepherdjerred/toolkit/lib/brim/cache.ts";
import type { Opener } from "@shepherdjerred/toolkit/lib/brim/sync/crypto.ts";
import { writePrivateFile } from "@shepherdjerred/toolkit/lib/brim/sync/manifest.ts";
import { readMirrorIndex } from "@shepherdjerred/toolkit/lib/brim/sync/mirror-index.ts";
import type { ObjectStore } from "@shepherdjerred/toolkit/lib/brim/sync/object-store.ts";
import { defaultBrimSyncPaths } from "@shepherdjerred/toolkit/lib/brim/sync/paths.ts";
import { pullArchive } from "@shepherdjerred/toolkit/lib/brim/sync/pull.ts";
import { z } from "zod";

const ArchiveStatusSchema = z.object({
  lastSuccessfulSyncAt: z.iso.datetime().nullable(),
  devices: z.array(
    z.object({
      machineId: z.string(),
      displayName: z.string(),
      lastArchivedAt: z.iso.datetime(),
      lastIndexedAt: z.iso.datetime(),
    }),
  ),
});

export async function openBrimArchive(options: {
  home: string;
  store: ObjectStore;
  open: Opener;
  loadQuotaSnapshots: () => Promise<readonly UsageSnapshot[] | null>;
}) {
  const historyPaths = defaultHistoryPaths(options.home);
  const runtime = defaultHistoryRuntimePaths(options.home);
  const mirror = defaultBrimSyncPaths(options.home);
  const statusPath = path.join(runtime.historyDir, "archive-status.json");
  const statusFile = Bun.file(statusPath);
  const index = await HistoryIndex.open(runtime);
  const captureArchive = await CaptureArchiveReader.open({
    directory: path.join(runtime.historyDir, "archived-captures"),
    store: options.store,
    open: options.open,
  });
  const sources = createHistorySources().filter((source) =>
    source.name.endsWith("-mirror"),
  );
  let status: z.infer<typeof ArchiveStatusSchema> = (await statusFile.exists())
    ? ArchiveStatusSchema.parse(await statusFile.json())
    : { lastSuccessfulSyncAt: null, devices: [] };

  async function refresh() {
    const report = await pullArchive({
      store: options.store,
      open: options.open,
      paths: mirror,
      // A cluster reader has no writer ID. A colon cannot occur in a writer ID.
      machineId: ":cluster-reader",
      sinceDays: null,
    });
    const results = await scanHistorySources(sources, historyPaths);
    const failedSources = results.filter((result) => result.error !== null);
    if (failedSources.length > 0) {
      throw new Error(
        `Archive indexing failed for ${failedSources.map((source) => source.source).join(", ")}`,
      );
    }
    await index.ingest(results);
    for (const source of sources) source.commitScan?.();

    const mirrorIndex = await readMirrorIndex(mirror.mirrorIndex);
    if (mirrorIndex === null)
      throw new Error("Archive pull did not publish its index");
    const indexedAt = new Date().toISOString();
    const previousDevices = new Map(
      status.devices.map((device) => [device.machineId, device]),
    );
    const refreshed = new Set(
      report.machines.map((device) => device.machineId),
    );
    for (const machine of mirrorIndex.machines) {
      if (!refreshed.has(machine.machineId)) continue;
      previousDevices.set(machine.machineId, {
        machineId: machine.machineId,
        displayName: machine.displayName,
        lastArchivedAt: machine.manifestUpdatedAt,
        lastIndexedAt: indexedAt,
      });
    }
    await captureArchive.refresh();
    const next = {
      lastSuccessfulSyncAt:
        report.errors.length === 0 ? indexedAt : status.lastSuccessfulSyncAt,
      devices: [...previousDevices.values()],
    };
    await writePrivateFile(statusPath, JSON.stringify(next));
    status = next;
    if (report.errors.length > 0) {
      throw new Error(
        `Archive pull failed for ${String(report.errors.length)} devices`,
      );
    }
    return status;
  }

  let running: ReturnType<typeof refresh> | undefined;
  async function refreshAndRelease() {
    try {
      return await refresh();
    } finally {
      running = undefined;
    }
  }
  return {
    status: () => status,
    refresh: () => (running ??= refreshAndRelease()),
    read: (request: Request) =>
      handleHistoryApiRequest(
        {
          index,
          captureArchive,
          now: () => new Date(),
          readMessages: (records) => targetedMessages(records, historyPaths),
          loadQuotaSnapshots: options.loadQuotaSnapshots,
        },
        request,
      ),
    close() {
      captureArchive.close();
      index.close();
    },
  };
}
