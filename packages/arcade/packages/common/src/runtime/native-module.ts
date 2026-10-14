import { z } from "zod";

export const UpstreamMessageSchema = z.looseObject({
  type: z.string(),
  message: z.string().optional(),
});

export function upstreamCommand(data: unknown): void {
  globalThis.dispatchEvent(
    new MessageEvent("message", {
      source: globalThis.window,
      origin: location.origin,
      data,
    }),
  );
}

export function remoteDisc(size: number) {
  return {
    size,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => {
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end <= start ||
          end > size
        )
          throw new Error("Disc read is out of bounds");
        const response = await fetch("/melee/disc.iso", {
          headers: { Range: `bytes=${String(start)}-${String(end - 1)}` },
        });
        if (response.status !== 206)
          throw new Error("Disc server did not honor a range read");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== end - start)
          throw new Error("Disc server returned an incomplete read");
        return bytes;
      },
    }),
  };
}
