import { writeFileAtomic } from "@shepherdjerred/discord-stream-lifecycle/persistence/atomic-write";
import { flashSaveLoadInvalidTotal } from "#src/observability/metrics.ts";

/**
 * Validate a flash save read from disk. A wrong-size image refuses the boot
 * rather than starting a blank game, because the stop-time flush would then
 * overwrite the existing (possibly recoverable) save with it.
 */
export function requireFlashImage(
  saved: Uint8Array,
  path: string,
  expectedBytes: number,
): Uint8Array {
  if (saved.length !== expectedBytes) {
    flashSaveLoadInvalidTotal.inc();
    throw new Error(
      `flash save at ${path} has the wrong size (${String(saved.length)} bytes, expected ${String(expectedBytes)}); refusing to overwrite it`,
    );
  }
  return saved;
}

type PersistenceRequest = {
  path: string;
  data: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class AtomicFlashPersistence {
  private readonly queue: PersistenceRequest[] = [];
  private running = false;

  enqueue(path: string, data: Uint8Array): Promise<undefined> {
    const gate = Promise.withResolvers<undefined>();
    this.queue.push({
      path,
      data,
      resolve: () => {
        gate.resolve(undefined);
      },
      reject: (error) => {
        gate.reject(error);
      },
    });
    void this.drain();
    return gate.promise;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const request = this.queue.shift();
        if (request === undefined) return;
        try {
          await this.persist(request.path, request.data);
          request.resolve();
        } catch (error) {
          request.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async persist(path: string, data: Uint8Array): Promise<void> {
    // Unique temp file + fsync + rename + directory fsync: a crash or power loss
    // leaves the previous complete save, never a torn one.
    await writeFileAtomic(path, data);
  }
}
