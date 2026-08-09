import { z } from "zod";

export const ChangeSchema = z.object({
  sequence: z.number().int().positive(),
  reason: z.enum(["webhook", "reconciliation", "email", "retention"]),
});
export type Change = z.infer<typeof ChangeSchema>;

type Listener = (change: Change) => void;

export class ChangeBus {
  readonly #listeners = new Set<Listener>();
  #sequence = 0;

  publish(reason: Change["reason"]): void {
    this.#sequence += 1;
    const change = ChangeSchema.parse({ sequence: this.#sequence, reason });
    for (const listener of this.#listeners) listener(change);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export async function* changeStream(
  bus: ChangeBus,
  signal: AbortSignal | undefined,
): AsyncGenerator<Change> {
  const controller = signal ?? new AbortController().signal;
  const queue: Change[] = [];
  let resolveNext: ((value: Change | null) => void) | null = null;
  const unsubscribe = bus.subscribe((change) => {
    if (resolveNext === null) {
      queue.push(change);
      return;
    }
    const resolve = resolveNext;
    resolveNext = null;
    resolve(change);
  });
  const abort = (): void => {
    if (resolveNext === null) return;
    const resolve = resolveNext;
    resolveNext = null;
    resolve(null);
  };
  controller.addEventListener("abort", abort, { once: true });
  try {
    while (!controller.aborted) {
      const queued = queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      const change = await new Promise<Change | null>((resolve) => {
        resolveNext = resolve;
      });
      if (change === null) return;
      yield change;
    }
  } finally {
    controller.removeEventListener("abort", abort);
    unsubscribe();
  }
}
