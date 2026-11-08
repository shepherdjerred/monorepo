import path from "node:path";
import { z } from "zod";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { ownedSubtitleSidecars } from "./ownership.ts";

/** The original inspection projection; every installed binding is still
 * checked before IDs for its exact physical quarantine are allocated. */
export function inspectPreviousSidecars(
  context: FileContext,
  kind: "movies" | "tv",
  previous: Parameters<typeof ownedSubtitleSidecars>[0] | null,
) {
  return (previous === null ? [] : ownedSubtitleSidecars(previous)).map(
    (subtitle) => {
      if (subtitle.path === null)
        throw new FileGuardError("subtitle_path_missing");
      const checksum = z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .parse(subtitle.checksum);
      return {
        subtitleId: subtitle.id,
        libraryPath: path.relative(
          context.roots[kind].library,
          workerFilePath(context, subtitle.path),
        ),
        checksum,
        quarantineId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
      };
    },
  );
}
