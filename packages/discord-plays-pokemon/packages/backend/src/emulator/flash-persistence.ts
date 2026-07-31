import { rename } from "node:fs/promises";

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
    const temporaryPath = `${path}.tmp`;
    await Bun.write(temporaryPath, data);
    await rename(temporaryPath, path);
  }
}
