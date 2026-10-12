import { z } from "zod";

const Vec3Schema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

/** What the parent hands the compile child (as a JSON file path in argv). */
export const CompileJobSchema = z.strictObject({
  program: z.string(),
  out: z.string(),
  seed: z.number().int(),
  anchor: Vec3Schema,
  site: z.strictObject({ info: z.string(), schematic: z.string() }).nullable(),
});
export type CompileJob = z.infer<typeof CompileJobSchema>;

/** What the child writes back. */
export const CompileResultSchema = z.strictObject({
  min: Vec3Schema,
  size: Vec3Schema,
  palette: z.array(z.string()),
  /** base64 little-endian uint32 palette indices, YZX. */
  data: z.string(),
  clears: z.array(
    z.strictObject({
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
      w: z.number().int(),
      h: z.number().int(),
      d: z.number().int(),
    }),
  ),
  logs: z.array(z.string()),
  blocks: z.number().int(),
});
export type CompileResult = z.infer<typeof CompileResultSchema>;
