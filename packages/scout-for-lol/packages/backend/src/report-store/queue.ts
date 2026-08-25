import {
  QueueTypeSchema,
  queueMatchesGameVariant,
  type CompetitionGameVariant,
  type CompetitionQueueType,
  type QueueType,
} from "@scout-for-lol/data";

export function competitionQueuesToStoredQueues(
  queues: readonly CompetitionQueueType[],
  gameVariant: CompetitionGameVariant,
): QueueType[] {
  if (queues.includes("ALL")) {
    return QueueTypeSchema.options.filter((queue) =>
      queueMatchesGameVariant(queue, gameVariant),
    );
  }
  return queues.map((queue) => QueueTypeSchema.parse(queue));
}
