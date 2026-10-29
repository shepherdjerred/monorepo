import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { CaptureContext } from "./define.ts";
import type { Presentation } from "#protocol/media.ts";

type Native = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
const RecorderSchema = z.object({
  state: z.string(),
  error: z.string(),
  receipt: z.string(),
});

export function createRecorder(
  native: Native,
  save: (presentation: Presentation, source: string) => Promise<void>,
  stopFile: string,
  active?: (value: boolean) => void,
): CaptureContext["record"] {
  return async (presentation, action, seconds = 12) => {
    const wait = async (wanted: string) => {
      const deadline = performance.now() + (seconds + 30) * 1000;
      while (performance.now() < deadline) {
        const result = RecorderSchema.parse(await native("record-status"));
        if (result.state === "FAILED") throw new Error(result.error);
        if (result.state === wanted) return result;
        if (await Bun.file(stopFile).exists())
          throw new Error("Capture stopped");
        await Bun.sleep(100);
      }
      throw new Error(`Recording did not reach ${wanted}`);
    };
    try {
      await native("record-arm", {
        name: `${presentation.name.slice(0, 42)}-${randomUUID()}`,
        frames: seconds * 30,
      });
      await wait("READY");
      await native("record-start");
      active?.(true);
      await native("record-marker", { name: "__capture_start" });
      await action();
      await native("record-marker", { name: "__capture_end" });
      active?.(false);
      const result = await wait("COMPLETE");
      await save(presentation, result.receipt);
    } finally {
      active?.(false);
      await native("record-cancel");
    }
  };
}
