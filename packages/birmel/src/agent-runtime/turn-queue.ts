const tails = new Map<string, Promise<void>>();

export async function withTurnQueue<T>(
  queueId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(queueId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(queueId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (tails.get(queueId) === current) {
      tails.delete(queueId);
    }
  }
}

export function activeTurnQueueCount(): number {
  return tails.size;
}
