import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  BUILD_FILES,
  BuildLogEntrySchema,
  type BuildLogEntry,
  type BuildManifest,
} from "#protocol/build.ts";
import { iterationOf, readLog } from "#build/build-log.ts";
import { publishFiles } from "#build/file-transaction.ts";
import { BuildWorkspace } from "#build/workspace.ts";

type Outcome = Extract<BuildLogEntry, { kind: "accept" | "reject" }>;
export type OutcomeInput = Omit<Outcome, "at" | "iteration">;

/** Publish both outcomes and the checkpoint; retry never duplicates an existing verdict. */
export async function publishBoutState(
  workspace: BuildWorkspace,
  input: {
    manifest: BuildManifest;
    outcomes: readonly OutcomeInput[];
  },
): Promise<void> {
  await publishFiles(workspace, {
    prefix: ".bout-",
    stage: async (staged) => {
      const entries = await readLog(workspace.dir);
      for (const outcome of input.outcomes) {
        const previous = entries.filter(
          (entry) =>
            entry.kind === outcome.kind &&
            "file" in entry &&
            entry.file === outcome.file &&
            (outcome.file !== null ||
              (entry.candidate === outcome.candidate &&
                entry.gridHash === outcome.gridHash &&
                entry.rubric === outcome.rubric &&
                entry.critique === outcome.critique &&
                entry.score === outcome.score &&
                entry.iteration === iterationOf(entries))),
        );
        if (previous.length > 1)
          throw new Error("duplicate persisted bout outcome");
        const existing = previous[0];
        const full = BuildLogEntrySchema.parse({
          ...outcome,
          at: existing?.at ?? new Date().toISOString(),
          iteration: existing?.iteration ?? iterationOf(entries),
        });
        if (existing === undefined) entries.push(full);
        else {
          if (!isDeepStrictEqual(existing, full))
            throw new Error(
              "persisted bout outcome does not match validated verdict",
            );
        }
      }
      await new BuildWorkspace(staged).writeManifest(input.manifest);
      const files: string[] = [];
      if (input.outcomes.length > 0) {
        await Bun.write(
          path.join(staged, BUILD_FILES.journal),
          entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        );
        files.push(BUILD_FILES.journal);
      }
      return [...files, BUILD_FILES.manifest];
    },
  });
}
