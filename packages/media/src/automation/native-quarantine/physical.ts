import { FileOperations } from "#filesystem/operations.ts";
import { unmanagedSidecars } from "#automation/handoff/sidecars.ts";
import { verifyJournalProof } from "#automation/handoff/journals.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { PreparedNativeQuarantine } from "./files.ts";
import { quarantineLocalPaths } from "./paths.ts";

export async function assertQuarantinePhysical(
  context: NativeFileContext,
  prepared: PreparedNativeQuarantine,
) {
  for (const participant of prepared.evidence.participants) {
    const local = await quarantineLocalPaths(context, participant);
    if (
      (await prepared.content.digest(local.canonical)) !== null ||
      (await prepared.content.digest(local.quarantined)) !==
        participant.checksum
    )
      throw new Error("Quarantine physical association changed");
    const neighbors =
      participant.subtitleId === null
        ? await unmanagedSidecars(local.canonical)
        : [];
    if (neighbors.length > 0)
      throw new Error("Quarantine canonical sidecar neighbors changed");
  }
  for (const journal of prepared.journals) await verifyJournalProof(journal);
}

/** PG locks precede exact canonical-absence and quarantine-presence locks. No hashes here. */
export async function withQuarantineLocks<T>(
  context: NativeFileContext,
  prepared: PreparedNativeQuarantine,
  action: () => Promise<T>,
): Promise<T> {
  const kinds = ["movies", "tv"] as const;
  const enter = async (index: number): Promise<T> => {
    const kind = kinds[index];
    if (kind === undefined) {
      await assertQuarantinePhysical(context, prepared);
      const result = await action();
      await assertQuarantinePhysical(context, prepared);
      return result;
    }
    const participants = prepared.evidence.participants.filter(
      (item) => item.libraryKind === kind,
    );
    if (participants.length === 0) return await enter(index + 1);
    const operations = new FileOperations(context.files.roots[kind], {
      authorize: () =>
        Promise.reject(new Error("Quarantine rebaseline cannot move files")),
      contentProof: prepared.content,
      ...(context.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
    });
    return await operations.withContentPaths(
      participants.flatMap((item) => [
        { root: "library", path: item.libraryPath },
        { root: "control", path: `quarantine/${item.quarantineId}` },
      ]),
      () => enter(index + 1),
    );
  };
  return await enter(0);
}
