import path from "node:path";
import { BUILD_FILES } from "#protocol/build.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { publishFiles } from "#build/file-transaction.ts";
import { stageJournal } from "#build/storage/evidence-publication.ts";

/** Stage a working version and roll back both files if any rename fails. */
export async function installWorkingFiles(
  workspace: BuildWorkspace,
  input: { program: Uint8Array | null; oplog: string; pick?: string },
): Promise<void> {
  await publishFiles(workspace, {
    prefix: ".pick-",
    stage: async (staged) => {
      if (input.program !== null)
        await Bun.write(path.join(staged, BUILD_FILES.program), input.program);
      await Bun.write(path.join(staged, BUILD_FILES.oplog), input.oplog);
      const files: string[] = [BUILD_FILES.program, BUILD_FILES.oplog];
      if (input.pick !== undefined) {
        await stageJournal(workspace, new BuildWorkspace(staged), {
          kind: "candidate",
          action: "pick",
          name: input.pick,
        });
        files.push(BUILD_FILES.journal);
      }
      return files;
    },
  });
}
