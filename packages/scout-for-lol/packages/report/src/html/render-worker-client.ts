import { getItemImage } from "#src/dataDragon/image-cache.ts";
import {
  RenderWorkerReadyMessageSchema,
  RenderWorkerResponseSchema,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
  type RenderWorkerTask,
} from "#src/html/render-worker-protocol.ts";

/**
 * Keep CPU-bound Satori + `@resvg/resvg-js` rasterization off the main JS event
 * loop so real-time activities sharing the process (such as Temporal
 * `deliverNotification` heartbeats) never stall behind 4760x3500 canvas work.
 *
 * A single dedicated worker thread with a FIFO concurrency gate bounds peak
 * native/WASM memory (RGBA pixel buffers + CJK OpenType tables) to one active
 * render at a time while keeping fonts and Data Dragon assets warm across jobs.
 */
const DEFAULT_MAX_CONCURRENCY = 1;

type PendingRequest = {
  readonly resolve: (
    response: Extract<RenderWorkerResponse, { ok: true }>,
  ) => void;
  readonly reject: (error: Error) => void;
};

type ActiveWorkerHandle = {
  readonly worker: Worker;
  readonly ready: Promise<void>;
};

export type RenderWorkerClientOptions = {
  readonly maxConcurrency?: number;
  readonly workerUrl?: string;
};

export type RenderWorkerClient = {
  readonly runSvg: (task: RenderWorkerTask) => Promise<string>;
  readonly runPng: (task: RenderWorkerTask) => Promise<Buffer>;
  readonly dispose: () => void;
};

export function resolveRenderWorkerUrl(
  metaUrl: string = import.meta.url,
): string {
  return metaUrl.endsWith(".ts") || metaUrl.endsWith(".tsx")
    ? new URL("render-worker.ts", metaUrl).href
    : new URL("render-worker.js", metaUrl).href;
}

function refWorker(worker: Worker): void {
  if ("ref" in worker && typeof worker.ref === "function") {
    worker.ref();
  }
}

function unrefWorker(worker: Worker): void {
  if ("unref" in worker && typeof worker.unref === "function") {
    worker.unref();
  }
}

function replayMissedItems(missedItemIds: readonly number[]): void {
  for (const itemId of missedItemIds) {
    // Replays `onItemMissHandler` on the main thread for metrics and logging.
    getItemImage(itemId);
  }
}

function reconstructWorkerError(serialized: {
  readonly name: string;
  readonly message: string;
  readonly stack?: string | undefined;
}): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) {
    error.stack = serialized.stack;
  }
  return error;
}

export function createRenderWorkerClient(
  options: RenderWorkerClientOptions = {},
): RenderWorkerClient {
  const maxConcurrency = Math.max(
    1,
    options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
  );
  const resolvedWorkerUrl = options.workerUrl ?? resolveRenderWorkerUrl();

  let activeCount = 0;
  let nextRequestId = 1;
  let handle: ActiveWorkerHandle | undefined;
  const waitQueue: (() => void)[] = [];
  const pending = new Map<number, PendingRequest>();

  const acquireSlot = async (): Promise<void> => {
    if (activeCount < maxConcurrency) {
      activeCount += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waitQueue.push(() => {
        activeCount += 1;
        resolve();
      });
    });
  };

  const releaseSlot = (): void => {
    activeCount = Math.max(0, activeCount - 1);
    const next = waitQueue.shift();
    if (next !== undefined) {
      next();
    }
  };

  const failAllPending = (cause: Error): void => {
    const entries = [...pending.values()];
    pending.clear();
    const deadHandle = handle;
    handle = undefined;
    if (deadHandle !== undefined) {
      unrefWorker(deadHandle.worker);
      deadHandle.worker.terminate();
    }
    for (const entry of entries) {
      entry.reject(cause);
    }
  };

  const ensureWorker = (): ActiveWorkerHandle => {
    if (handle !== undefined) {
      return handle;
    }
    const created = new Worker(resolvedWorkerUrl);
    refWorker(created);

    let resolveReady: (() => void) | undefined;
    let rejectReady: ((error: Error) => void) | undefined;
    let isReady = false;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = () => {
        isReady = true;
        resolve();
      };
      rejectReady = reject;
    });

    created.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (RenderWorkerReadyMessageSchema.safeParse(event.data).success) {
        resolveReady?.();
        if (pending.size === 0 && handle?.worker === created) {
          unrefWorker(created);
        }
        return;
      }

      const parsed = RenderWorkerResponseSchema.safeParse(event.data);
      if (!parsed.success) {
        failAllPending(
          new Error(
            `Invalid response from report render worker: ${parsed.error.message}`,
          ),
        );
        return;
      }
      const response = parsed.data;
      const entry = pending.get(response.id);
      if (entry === undefined) {
        return;
      }
      pending.delete(response.id);
      if (pending.size === 0 && handle?.worker === created) {
        unrefWorker(created);
      }
      replayMissedItems(response.missedItemIds);
      if (response.ok) {
        entry.resolve(response);
      } else {
        entry.reject(reconstructWorkerError(response.error));
      }
    });

    created.addEventListener("error", (event: ErrorEvent) => {
      const message =
        event.message.length > 0
          ? event.message
          : "Report render worker crashed";
      const error = new Error(message);
      if (!isReady) {
        rejectReady?.(error);
      }
      failAllPending(error);
    });

    created.addEventListener("close", () => {
      if (handle?.worker === created) {
        handle = undefined;
      }
      const error = new Error(
        "Report render worker exited before completing render",
      );
      if (!isReady) {
        rejectReady?.(error);
      }
      if (pending.size > 0) {
        failAllPending(error);
      }
    });

    handle = { worker: created, ready };
    return handle;
  };

  const dispatch = async (
    task: RenderWorkerTask,
  ): Promise<Extract<RenderWorkerResponse, { ok: true }>> => {
    await acquireSlot();
    try {
      const active = ensureWorker();
      refWorker(active.worker);
      await active.ready;
      const id = nextRequestId;
      nextRequestId += 1;
      const request: RenderWorkerRequest = { id, task };
      return await new Promise<Extract<RenderWorkerResponse, { ok: true }>>(
        (resolve, reject) => {
          pending.set(id, { resolve, reject });
          refWorker(active.worker);
          try {
            active.worker.postMessage(request);
          } catch (error) {
            pending.delete(id);
            if (pending.size === 0) {
              unrefWorker(active.worker);
            }
            reject(
              error instanceof Error
                ? error
                : new Error(
                    `Failed to post task to render worker: ${String(error)}`,
                  ),
            );
          }
        },
      );
    } finally {
      releaseSlot();
    }
  };

  return {
    runSvg: async (task) => {
      const response = await dispatch(task);
      if (response.result.kind !== "svg") {
        throw new Error(
          `Expected SVG result from render worker, received ${response.result.kind}`,
        );
      }
      return response.result.svg;
    },
    runPng: async (task) => {
      const response = await dispatch(task);
      if (response.result.kind !== "png") {
        throw new Error(
          `Expected PNG result from render worker, received ${response.result.kind}`,
        );
      }
      const { bytes } = response.result;
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    dispose: () => {
      failAllPending(new Error("Report render worker client disposed"));
    },
  };
}

const defaultRenderWorkerClient = createRenderWorkerClient();

export async function runSvgRenderInWorker(
  task: RenderWorkerTask,
): Promise<string> {
  return await defaultRenderWorkerClient.runSvg(task);
}

export async function runPngRenderInWorker(
  task: RenderWorkerTask,
): Promise<Buffer> {
  return await defaultRenderWorkerClient.runPng(task);
}
