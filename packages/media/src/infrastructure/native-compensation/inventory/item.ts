import type { MediaPublicationTransition } from "#generated/prisma/client.ts";

/** Scalar inventory projection; protocol eligibility and pagination stay local. */
export function compensationInventoryItem(input: {
  transition: Pick<
    MediaPublicationTransition,
    "id" | "attemptId" | "birthEpoch"
  >;
  media: { id: string; title: string }[];
  entries: readonly {
    predecessor: { id: string; path: string } | null;
    entry: { assetId: string };
  }[];
}) {
  return {
    transitionId: input.transition.id,
    attemptId: input.transition.attemptId,
    birthEpoch: input.transition.birthEpoch,
    media: input.media,
    predecessors: input.entries.flatMap((item) =>
      item.predecessor === null
        ? []
        : [{ assetId: item.predecessor.id, path: item.predecessor.path }],
    ),
    successorAssetIds: input.entries.map((item) => item.entry.assetId),
  };
}
