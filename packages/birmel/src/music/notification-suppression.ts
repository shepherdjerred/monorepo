const suppressedQueues = new WeakSet<object>();

export function isQueueNotificationSuppressed(queue: object): boolean {
  return suppressedQueues.has(queue);
}

export function withoutQueueNotifications<T>(
  queue: object,
  action: () => T,
): T {
  suppressedQueues.add(queue);
  try {
    return action();
  } finally {
    suppressedQueues.delete(queue);
  }
}
