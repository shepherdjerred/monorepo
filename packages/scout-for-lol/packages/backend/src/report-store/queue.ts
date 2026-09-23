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
  return queues.includes("ALL")
    ? QueueTypeSchema.options.filter((queue) =>
        queueMatchesGameVariant(queue, gameVariant),
      )
    : queues.map((queue) => QueueTypeSchema.parse(queue));
}
