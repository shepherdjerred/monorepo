export function createSingleFlightRunner(
  operation: () => Promise<void>,
): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await operation();
    } finally {
      running = false;
    }
  };
}
