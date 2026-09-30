type SubscriptionCategory = {
  id: string;
  label: string;
};

type CategorizedSubscription = {
  id: string;
  title: string;
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

export function isInCategory(
  subscription: CategorizedSubscription,
  category: string,
): boolean {
  return subscription.categories.some(
    (candidate) => candidate.label === category,
  );
}

export function unmanagedFingerprint(
  subscriptions: CategorizedSubscription[],
  desiredUrls: Set<string>,
  category: string,
): string {
  return JSON.stringify(
    subscriptions
      .filter(
        (subscription) =>
          !desiredUrls.has(subscription.url) &&
          !isInCategory(subscription, category),
      )
      .map((subscription) => ({
        id: subscription.id,
        title: subscription.title,
        url: subscription.url,
        categories: subscription.categories
          .map((candidate) => ({ id: candidate.id, label: candidate.label }))
          .toSorted((left, right) => left.id.localeCompare(right.id)),
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  );
}
