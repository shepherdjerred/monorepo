import path from "node:path";
import { PresentationSchema } from "#protocol/media.ts";
import type { z } from "zod";
import { save, type CaptureRun } from "./model.ts";
import { sha256 } from "./media.ts";

export function createCaptureSaver(directory: string, run: CaptureRun) {
  return async (
    presentation: z.infer<typeof PresentationSchema>,
    source: string,
  ) => {
    PresentationSchema.parse(presentation);
    if (run.captures.some((capture) => capture.name === presentation.name))
      throw new Error("Duplicate capture name");
    const file = path.join(directory, `${presentation.name}.presentation.json`);
    await Bun.write(file, JSON.stringify(presentation, null, 2));
    run.captures.push({
      name: presentation.name,
      source,
      sourceHash: await sha256(source),
      presentation: file,
    });
    await save(directory, run);
  };
}
