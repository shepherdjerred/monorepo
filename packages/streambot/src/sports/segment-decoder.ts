import { z } from "zod";
import { SportsPlaybackError } from "./failures.ts";

const ResultSchema = z.discriminatedUnion("ok", [
  z.object({
    id: z.number().int(),
    ok: z.literal(true),
    bytes: z.instanceof(Uint8Array),
  }),
  z.object({ id: z.number().int(), ok: z.literal(false) }),
]);

/** One bounded decoder per playback lease keeps PNG inflate/filter work off Discord's event loop. */
export class SportsSegmentDecoder {
  private worker: Worker | undefined;
  private workerClosed = false;
  private closed = false;
  private closing: Promise<void> | undefined;
  private sequence = 0;
  private readonly pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<Uint8Array>>
  >();

  async decode(bytes: Uint8Array): Promise<Uint8Array> {
    if (this.closed) throw new SportsPlaybackError("session-expired");
    if (this.workerClosed) throw new SportsPlaybackError("unavailable");
    if (
      bytes[0] !== 137 ||
      bytes[1] !== 80 ||
      bytes[2] !== 78 ||
      bytes[3] !== 71
    )
      return bytes;
    if (this.pending.size >= 4) throw new SportsPlaybackError("unavailable");
    const worker = this.getWorker();
    const id = this.sequence++;
    const pending = Promise.withResolvers<Uint8Array>();
    this.pending.set(id, pending);
    const input = new Uint8Array(bytes);
    try {
      worker.postMessage({ id, bytes: input }, [input.buffer]);
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return await pending.promise;
  }

  private rejectPending(): void {
    for (const pending of this.pending.values())
      pending.reject(new SportsPlaybackError("unavailable"));
    this.pending.clear();
  }

  private getWorker(): Worker {
    if (this.worker !== undefined) return this.worker;
    const worker = new Worker(
      new URL("segment-worker.ts", import.meta.url).href,
    );
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const result = ResultSchema.parse(event.data);
      const pending = this.pending.get(result.id);
      if (pending === undefined) return;
      this.pending.delete(result.id);
      if (result.ok) pending.resolve(result.bytes);
      else pending.reject(new SportsPlaybackError("unsupported-format"));
    });
    worker.addEventListener("error", () => {
      this.rejectPending();
      worker.terminate();
    });
    worker.addEventListener("close", () => {
      this.workerClosed = true;
      this.rejectPending();
    });
    this.worker = worker;
    return worker;
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.rejectPending();
    const worker = this.worker;
    this.closing =
      worker === undefined || this.workerClosed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            worker.addEventListener(
              "close",
              () => {
                resolve();
              },
              { once: true },
            );
            worker.terminate();
          });
    return this.closing;
  }
}
