import path from "node:path";
import { BUILD_FILES } from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { publishFiles } from "#build/file-transaction.ts";

/** Stage a working version and roll back both files if any rename fails. */
export async function installWorkingFiles(
  workspace: BuildWorkspace,
  input: { program: Uint8Array | null; oplog: string },
): Promise<void> {
  await publishFiles(workspace, {
    prefix: ".pick-",
    stage: async (staged) => {
      if (input.program !== null)
        await Bun.write(path.join(staged, BUILD_FILES.program), input.program);
      await Bun.write(path.join(staged, BUILD_FILES.oplog), input.oplog);
      return [BUILD_FILES.program, BUILD_FILES.oplog];
    },
  });
}
