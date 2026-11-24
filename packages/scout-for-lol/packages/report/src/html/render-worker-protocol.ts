import type {
  ArenaMatch,
  ClassicMatch,
  CompletedMatch,
  LoadingScreenData,
} from "@scout-for-lol/data";
import type { RankedDesign } from "#src/html/shared/pick-design.ts";
import { z } from "zod";

const RankedDesignSchema: z.ZodType<RankedDesign> = z.enum([
  "banner",
  "square",
]);

export type RenderMatchOptions = {
  /**
   * Force a specific ranked design rather than the hash-derived pick. Only
   * applies when the queue is ranked solo/flex; ignored otherwise.
   */
  designOverride?: RankedDesign | undefined;
  /**
   * Gate the new ranked banner/square designs. When `false`, ranked solo/flex
   * matches fall back to the legacy 4760×3500 report. Defaults to `true`.
   * The backend sets this to `false` outside local dev so the redesign stays
   * local-only until it's promoted.
   */
  enableRankedDesigns?: boolean | undefined;
};

export type RenderSvgToPngOptions = {
  crop?: boolean | undefined;
};

function isNonNullObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

// Validate the IPC envelope without adding stricter field constraints than the
// TypeScript entrypoints (`matchToSvg`, `classicMatchToSvg`, etc.) enforced
// before worker offloading (e.g. zeroed-out fixture fields or empty-roster
// domain errors thrown inside the layout).
const CompletedMatchPayloadSchema = z.custom<CompletedMatch>((value) =>
  isNonNullObject(value),
);

const ArenaMatchPayloadSchema = z.custom<ArenaMatch>((value) =>
  isNonNullObject(value),
);

const ClassicMatchPayloadSchema = z.custom<ClassicMatch>((value) =>
  isNonNullObject(value),
);

const LoadingScreenDataPayloadSchema = z.custom<LoadingScreenData>((value) =>
  isNonNullObject(value),
);

const RenderMatchOptionsSchema: z.ZodType<RenderMatchOptions> = z.strictObject({
  designOverride: RankedDesignSchema.optional(),
  enableRankedDesigns: z.boolean().optional(),
});

const RenderSvgToPngOptionsSchema: z.ZodType<RenderSvgToPngOptions> =
  z.strictObject({
    crop: z.boolean().optional(),
  });

export const RenderWorkerTaskSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("matchToSvg"),
    match: CompletedMatchPayloadSchema,
    options: RenderMatchOptionsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("svgToPng"),
    svg: z.string(),
    options: RenderSvgToPngOptionsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("arenaMatchToSvg"),
    match: ArenaMatchPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal("arenaMatchToImage"),
    match: ArenaMatchPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal("classicMatchToSvg"),
    match: ClassicMatchPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal("classicMatchToImage"),
    match: ClassicMatchPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal("loadingScreenToSvg"),
    data: LoadingScreenDataPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal("loadingScreenToImage"),
    data: LoadingScreenDataPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal("echartsSvgToPng"),
    svg: z.string(),
    fontFiles: z.array(z.string()).readonly(),
    defaultFontFamily: z.string(),
  }),
]);

export type RenderWorkerTask = z.infer<typeof RenderWorkerTaskSchema>;

export const RenderWorkerRequestSchema = z.strictObject({
  id: z.number().int().positive(),
  task: RenderWorkerTaskSchema,
});

export type RenderWorkerRequest = z.infer<typeof RenderWorkerRequestSchema>;

export const RenderWorkerResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    id: z.number().int().positive(),
    ok: z.literal(true),
    result: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("svg"),
        svg: z.string(),
      }),
      z.strictObject({
        kind: z.literal("png"),
        bytes: z.instanceof(Uint8Array),
      }),
    ]),
    missedItemIds: z.array(z.number().int()).readonly(),
  }),
  z.strictObject({
    id: z.number().int().positive(),
    ok: z.literal(false),
    error: z.strictObject({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    }),
    missedItemIds: z.array(z.number().int()).readonly(),
  }),
]);

export const RenderWorkerReadyMessageSchema = z.strictObject({
  kind: z.literal("render-worker-ready"),
});

export type RenderWorkerReadyMessage = z.infer<
  typeof RenderWorkerReadyMessageSchema
>;

export type RenderWorkerResponse = z.infer<typeof RenderWorkerResponseSchema>;

let runningInRenderWorker = false;

export function markRenderWorkerThread(): void {
  runningInRenderWorker = true;
}

export function isRenderWorkerThread(): boolean {
  return runningInRenderWorker;
}
