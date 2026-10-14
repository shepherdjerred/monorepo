import { z } from "zod";

export type BrowserGameModule = {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  FS: {
    syncfs: (
      populate: boolean,
      callback: (error?: Error | null) => void,
    ) => void;
  };
  onFrame?: (frame: number) => void;
  onAudio?: (samples: Float32Array, rate: number) => void;
  onArcadeFrame?: (frame: number) => void;
  onArcadeAudio?: (pointer: number, bytes: number, rate: number) => void;
  arcadePads?: readonly (readonly number[])[];
  _arcade_mkw_probe?: (frame: number) => number;
  _arcade_melee_probe?: () => number;
  _direct_set_pad?: (
    ...values: [
      port: number,
      buttons: number,
      x: number,
      y: number,
      cx: number,
      cy: number,
      l: number,
      r: number,
      connected: number,
    ]
  ) => void;
};
const callable = (value: unknown) => typeof value === "function";
const NativeExportsSchema = z.looseObject({
  HEAPU8: z.instanceof(Uint8Array),
  HEAP16: z.instanceof(Int16Array),
  FS: z.looseObject({
    syncfs: z.custom<BrowserGameModule["FS"]["syncfs"]>(callable),
  }),
  onFrame: z.custom<BrowserGameModule["onFrame"]>(callable).optional(),
  onAudio: z.custom<BrowserGameModule["onAudio"]>(callable).optional(),
  onArcadeFrame: z
    .custom<BrowserGameModule["onArcadeFrame"]>(callable)
    .optional(),
  onArcadeAudio: z
    .custom<BrowserGameModule["onArcadeAudio"]>(callable)
    .optional(),
  _arcade_mkw_probe: z
    .custom<BrowserGameModule["_arcade_mkw_probe"]>(callable)
    .optional(),
  _arcade_melee_probe: z
    .custom<BrowserGameModule["_arcade_melee_probe"]>(callable)
    .optional(),
  _direct_set_pad: z
    .custom<BrowserGameModule["_direct_set_pad"]>(callable)
    .optional(),
  arcadePads: z.array(z.array(z.number())).optional(),
});
// Preserve the SDK object's identity: it replaces its heap views when memory grows.
const NativeModuleSchema = z.custom<BrowserGameModule>(
  (value) => NativeExportsSchema.safeParse(value).success,
);
export function gameModule(): BrowserGameModule {
  const value: unknown = Reflect.get(globalThis, "Module");
  return NativeModuleSchema.parse(value);
}

export function readProbe(gameId: "mkwii" | "melee", frame: number): unknown {
  const module = gameModule();
  let pointer: number;
  if (gameId === "mkwii") {
    if (module._arcade_mkw_probe === undefined)
      throw new Error("MKW asset is missing the Arcade probe");
    pointer = module._arcade_mkw_probe(frame);
  } else {
    if (module._arcade_melee_probe === undefined)
      throw new Error("Melee asset is missing the Arcade probe");
    pointer = module._arcade_melee_probe();
  }
  const heap = module.HEAPU8;
  if (!Number.isInteger(pointer) || pointer <= 0 || pointer >= heap.length)
    throw new Error("Game probe returned an invalid pointer");
  const bytes = heap.subarray(pointer, Math.min(pointer + 8192, heap.length));
  const end = bytes.indexOf(0);
  if (end === -1) throw new Error("Game probe exceeded its buffer");
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, end)));
}

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
