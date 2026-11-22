import { parseArgs } from "node:util";
import { z } from "zod";
import { readFrozenSeerr } from "#migration/frozen-seerr/reader.ts";

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        sqlite: { type: "string" },
        "source-instance-id": { type: "string" },
        "source-version": { type: "string" },
        "writer-stopped": { type: "boolean", default: false },
      },
    });
    const result = await readFrozenSeerr(
      z.string().min(1).parse(values.sqlite),
      {
        sourceInstanceId: z.string().parse(values["source-instance-id"]),
        sourceVersion: z.string().parse(values["source-version"]),
        writerStopped: z.literal(true).parse(values["writer-stopped"]),
      },
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch {
    console.error(
      "Frozen Seerr read failed. Supply the stopped writer's unchanged SQLite image with settled WAL and its exact source identity/version; no writes were performed.",
    );
    process.exitCode = 1;
  }
}
