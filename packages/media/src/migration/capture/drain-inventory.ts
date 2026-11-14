import { z } from "zod";
import { CaptureReader } from "./capture-http.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const QueueEntry = z.object({
  id: z.int().nonnegative(),
  status: z.string().min(1).max(100),
  trackedDownloadStatus: z.string().max(100).optional(),
  trackedDownloadState: z.string().max(100).optional(),
});
const QueuePage = z.object({
  page: z.int().positive(),
  totalRecords: z.int().nonnegative().max(10_000),
  records: z.array(QueueEntry).max(100),
});
const Command = z.object({
  id: z.int().positive(),
  name: z.string().max(100),
  status: z.enum([
    "queued",
    "started",
    "completed",
    "failed",
    "aborted",
    "cancelled",
  ]),
});
type Source = {
  source: "radarr" | "sonarr";
  sourceInstanceId: string;
  baseUrl: string;
  apiKey: string;
};

async function inventory(source: Source, fetcher: typeof fetch) {
  const reader = new CaptureReader(source, fetcher);
  const queue: z.infer<typeof QueueEntry>[] = [];
  let total: number | undefined;
  for (let page = 1; total === undefined || queue.length < total; page++) {
    const result = await reader.read(
      `api/v3/queue?page=${String(page)}&pageSize=100`,
      QueuePage,
    );
    if (
      result.page !== page ||
      (total !== undefined && total !== result.totalRecords) ||
      result.records.length !==
        Math.min(100, result.totalRecords - queue.length)
    )
      throw new Error("Legacy queue changed or is incomplete");
    total = result.totalRecords;
    queue.push(...result.records);
  }
  if (new Set(queue.map((entry) => entry.id)).size !== queue.length)
    throw new Error("Legacy queue contains duplicate identities");
  const allCommands = await reader.read(
    "api/v3/command",
    z.array(Command).max(10_000),
  );
  const commands = allCommands.filter(
    (command) => command.status === "queued" || command.status === "started",
  );
  return {
    queue: queue.sort((a, b) => a.id - b.id),
    activeCommands: commands.sort((a, b) => a.id - b.id),
  };
}

/** GET-only drain evidence. An empty queue does not itself stop a legacy writer. */
export async function captureDrainInventory(
  source: Source,
  fetcher: typeof fetch = fetch,
) {
  const startedAt = new Date().toISOString();
  const first = await inventory(source, fetcher);
  const second = await inventory(source, fetcher);
  const stable =
    snapshotHash(z.json().parse(first)) ===
    snapshotHash(z.json().parse(second));
  return {
    schemaVersion: 1,
    sourceKind: source.source,
    sourceInstanceId: source.sourceInstanceId,
    startedAt,
    completedAt: new Date().toISOString(),
    stable,
    drained:
      stable && second.queue.length === 0 && second.activeCommands.length === 0,
    inventory: second,
    inventoryHash: snapshotHash(z.json().parse(second)),
    provesWritersStopped: false,
    changesTorrentOwnership: false,
  };
}
