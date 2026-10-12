import { z } from "zod";
import rawRelease from "./release.json";

export const LauncherReleaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    stage: z.enum(["prepared", "active"]),
  })
  .strict();

export const launcherRelease = LauncherReleaseSchema.parse(rawRelease);
