import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BoxSchema, InfoResponseSchema } from "#protocol/bridge.ts";
import { ClientNameSchema } from "#protocol/client.ts";
import { MediaName } from "#protocol/media.ts";
import { MapSourceSchema } from "#protocol/ipc.ts";

import { PlayerCheckpointSchema } from "#protocol/capture.ts";
import { CaptureResourceSchema } from "#protocol/capture.ts";

const CleanupSchema = z.union([
  z.strictObject({ kind: z.literal("command"), command: z.string() }),
  z.strictObject({
    kind: z.literal("break"),
    position: z.tuple([z.number(), z.number(), z.number()]),
    standing: z.tuple([z.number(), z.number(), z.number()]),
  }),
  ...CaptureResourceSchema.options.map((schema) =>
    schema.extend({ kind: z.literal("resource") }),
  ),
]);
export const RunSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string(),
  target: z.string(),
  mapSource: MapSourceSchema.optional(),
  reason: z.string().min(1),
  name: ClientNameSchema,
  inspectors: z.array(z.string()),
  server: InfoResponseSchema.nullable(),
  baseline: z.string().nullable(),
  scene: z.string(),
  sceneHash: z.string(),
  box: BoxSchema,
  anchor: z.tuple([z.number(), z.number(), z.number()]),
  state: z.enum([
    "preflight",
    "checkpoint",
    "setup",
    "capture",
    "cleanup",
    "complete",
    "failed",
    "needs-recovery",
  ]),
  checkpoint: PlayerCheckpointSchema.nullable(),
  snapshot: z.string().nullable(),
  inspection: z.record(z.string(), z.string()).nullable(),
  origin: z
    .strictObject({
      world: z.string(),
      position: z.tuple([z.number(), z.number(), z.number()]),
      yaw: z.number(),
      pitch: z.number(),
    })
    .nullable(),
  staging: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  cleanup: z.array(CleanupSchema),
  captures: z.array(
    z.strictObject({
      name: MediaName,
      source: z.string(),
      sourceHash: z.string(),
      presentation: z.string(),
    }),
  ),
  error: z.string(),
});
export type CaptureRun = z.infer<typeof RunSchema>;

export async function save(directory: string, run: CaptureRun): Promise<void> {
  const temporary = path.join(directory, "run.next.json");
  await Bun.write(temporary, JSON.stringify(run, null, 2));
  await rename(temporary, path.join(directory, "run.json"));
}

export async function initializeRun(
  directory: string,
  input: CaptureRun,
): Promise<void> {
  await mkdir(directory, { mode: 0o700 });
  await save(directory, RunSchema.parse(input));
}
