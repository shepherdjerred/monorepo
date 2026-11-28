import type { ReplayEngineFactory } from "@scout-for-lol/replay/engine";
import { ReplayCapabilityError } from "@scout-for-lol/replay/types";

export async function verifyRiftStartup(
  resources: Parameters<ReplayEngineFactory>[0]["resources"],
  replay: ArrayBuffer,
  signal: AbortSignal,
) {
  const pages = (await resources.read("rift-startup-pages.bin")).buffer;
  const worker = await resources.worker("rift-startup-worker.mjs");
  let abort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      worker.addEventListener(
        "message",
        ({ data }: MessageEvent<unknown>) => {
          if (
            data !== null &&
            typeof data === "object" &&
            "ok" in data &&
            data.ok === true
          ) {
            resolve();
          } else {
            const detail =
              data !== null &&
              typeof data === "object" &&
              "message" in data &&
              typeof data.message === "string"
                ? data.message
                : "No result from the original replay startup reader.";
            reject(new ReplayCapabilityError("invalid-package", detail));
          }
        },
        { once: true },
      );
      worker.addEventListener(
        "error",
        () =>
          reject(
            new ReplayCapabilityError(
              "invalid-package",
              "The replay startup worker failed.",
            ),
          ),
        { once: true },
      );
      worker.addEventListener(
        "messageerror",
        () =>
          reject(
            new ReplayCapabilityError(
              "invalid-package",
              "The replay startup worker returned invalid data.",
            ),
          ),
        { once: true },
      );
      const replayCopy = replay.slice(0);
      const pagesCopy = pages.slice(0);
      worker.postMessage({ replay: replayCopy, pages: pagesCopy }, [
        replayCopy,
        pagesCopy,
      ]);
    });
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}
