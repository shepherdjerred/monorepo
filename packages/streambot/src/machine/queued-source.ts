import type { QueuedSource } from "@shepherdjerred/streambot/machine/types.ts";

/** Keep durable queue metadata while allowing the source to resolve again. */
export function unresolvedQueuedSource(
  entry: Pick<QueuedSource, "source" | "requesterId"> & {
    display?: QueuedSource["display"];
    queuedAt?: QueuedSource["queuedAt"];
    requestId?: QueuedSource["requestId"];
  },
): QueuedSource {
  return {
    source: entry.source,
    requesterId: entry.requesterId,
    ...(entry.display === undefined ? {} : { display: entry.display }),
    ...(entry.queuedAt === undefined ? {} : { queuedAt: entry.queuedAt }),
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
  };
}
