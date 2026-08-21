type SubscriptionCategory = {
  label: string;
};

type CategorizedSubscription = {
  url: string;
  categories: SubscriptionCategory[];
};

export function assertNoSharedStaleSubscriptions(
  subscriptions: CategorizedSubscription[],
  desiredUrls: Set<string>,
  category: string,
): void {
  const sharedStale = subscriptions.filter(
    (subscription) =>
      subscription.categories.some(
        (candidate) => candidate.label === category,
      ) &&
      !desiredUrls.has(subscription.url) &&
      subscription.categories.some((candidate) => candidate.label !== category),
  );
  if (sharedStale.length > 0) {
    throw new Error(
      `Refusing to unsubscribe stale managed feeds that also belong to unmanaged categories: ${sharedStale
        .map((subscription) => subscription.url)
        .toSorted()
        .join(", ")}`,
    );
  }
}
