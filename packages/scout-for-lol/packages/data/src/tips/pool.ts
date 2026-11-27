/**
 * Run `work` over `items` with at most `concurrency` in flight, returning the
 * results in item order. The first failure stops new items from starting and
 * is rethrown once the ones already running settle.
 */
export async function mapPool<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  work: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  let failure: Error | undefined;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (failure === undefined && next < items.length) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) {
          return;
        }
        try {
          results[index] = await work(item, index);
        } catch (error: unknown) {
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
      }
    },
  );
  await Promise.all(lanes);
  if (failure !== undefined) {
    throw failure;
  }
  return results;
}
