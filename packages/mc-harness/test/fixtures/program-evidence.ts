import { BUILD_FILES } from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import {
  programSnapshot,
  recordProgramEvidence,
} from "#build/storage/program-evidence.ts";

/** Synthetic compile evidence uses the production checksum writer. */
export async function writeProgramFixture(
  workspace: BuildWorkspace,
  digest: string,
  text?: string,
): Promise<void> {
  await Bun.write(
    workspace.file(programSnapshot(digest)),
    text ?? (await Bun.file(workspace.file(BUILD_FILES.program)).text()),
  );
  await Bun.write(
    workspace.file(`schematics/program-${digest}.schem`),
    await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
  );
  const { ops } = await workspace.oplog();
  const programOps = ops.filter((op) => op.source === `program:${digest}`);
  await recordProgramEvidence(
    workspace,
    digest,
    programOps.flatMap((op) => (op.kind === "paste" ? [op.schematic] : [])),
    programOps,
  );
}
