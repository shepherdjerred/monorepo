import type { MediaAutomationContext } from "#automation/context.ts";

/** Registry adapters currently implement title search, not recent-release feeds. */
export async function sweepFeeds(
  context: MediaAutomationContext,
  cursor: string | null,
) {
  const providers = await context.db.mediaProvider.findMany({
    where: {
      enabled: true,
      ...(cursor === null ? {} : { id: { gt: cursor } }),
    },
    orderBy: { id: "asc" },
    take: 25,
  });
  for (const provider of providers) {
    await context.db.mediaProvider.update({
      where: { id: provider.id },
      data: { feedState: "unsupported_recent_feed", lastFeedAt: new Date() },
    });
  }
  return {
    processed: providers.length,
    nextCursor: providers.length === 25 ? (providers.at(-1)?.id ?? null) : null,
  };
}
