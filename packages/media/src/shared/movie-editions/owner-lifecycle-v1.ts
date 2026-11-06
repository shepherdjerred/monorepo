import { z } from "zod";
import { MovieLifecycleCommandV4Schema } from "./lifecycle-v4.ts";

const Applied = z.strictObject({
  mediaVersion: z.int().nonnegative(),
  targetVersion: z.int().nonnegative(),
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
});
const Source = z.strictObject({
  schemaVersion: z.literal(1),
  actorId: z.uuid(),
  request: MovieLifecycleCommandV4Schema,
  applied: Applied,
});

/** Distinct explicit owner decisions; neither supplies personal watch consent. */
export const MovieOwnerRemovalV1Schema = Source.refine(
  (source) => source.request.command.action === "remove",
  "Owner removal must retain its actual reviewed removal command",
);
export const MovieOwnerRestoreV1Schema = Source.refine(
  (source) => source.request.command.action === "restore",
  "Owner restoration must retain its actual restoration command",
);
export type MovieOwnerRemovalV1 = z.infer<typeof MovieOwnerRemovalV1Schema>;
export type MovieOwnerRestoreV1 = z.infer<typeof MovieOwnerRestoreV1Schema>;
