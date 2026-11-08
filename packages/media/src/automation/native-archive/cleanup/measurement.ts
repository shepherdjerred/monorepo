import type { MeasurementAuthority } from "#filesystem/content-measurement.ts";
import type { ArchiveExecutionDiscovery } from "#infrastructure/native-archive/execution/discovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { ArchiveFileContext } from "#automation/native-archive/execution.ts";
import { assertArchiveActive } from "#automation/native-archive/execution.ts";
import {
  archiveCleanupPaths,
  executionFor,
  assertCleanupContent,
} from "#automation/native-archive/cleanup-proof.ts";
import {
  prepareCleanupJournalProof,
  assertCleanupJournalProof,
} from "#automation/native-archive/journal-proof.ts";
import type {
  ArchiveCleanupFacts,
  ArchiveCleanupProof,
} from "#automation/native-archive/cleanup-types.ts";
import { measureArchiveContent } from "./content.ts";

/** Complete read-only measurement. No ContentProof or effect-capable context escapes. */
export async function measureArchiveCleanup(
  initial: ArchiveFileContext,
  discovery: ArchiveExecutionDiscovery,
  assertActive: () => void,
) {
  const context: ArchiveFileContext = {
    ...initial,
    execution: {
      ...initial.execution,
      assertActive: () => {
        assertArchiveActive(initial.execution);
        assertActive();
      },
    },
  };
  assertArchiveActive(context.execution);
  const { locator, descriptor, execution: committed } = discovery.entry;
  const execution = executionFor(locator, descriptor);
  if (committed !== null && snapshotHash(committed) !== snapshotHash(execution))
    throw new Error("Archive execution identity changed");
  const scope = discovery.effectiveScope;
  const paths = archiveCleanupPaths(descriptor, scope);
  const content = await measureArchiveContent(context, paths, assertActive);
  const facts: ArchiveCleanupFacts = {
    content: content.facts,
    paths,
    execution,
    executionCommitted: committed !== null,
    descriptor,
    scope,
  };
  await assertCleanupContent(context, facts);
  const journals = await prepareCleanupJournalProof(context, facts);
  const measured = { ...facts, journals };
  await assertCleanupJournalProof(context, measured);
  assertArchiveActive(context.execution);
  return Object.freeze({
    kind: "measurement" as const,
    execution,
    scopeHash: snapshotHash(nativeJson(scope)),
    async seal(authority: MeasurementAuthority): Promise<ArchiveCleanupProof> {
      const currentActive = authority.assertActive;
      assertArchiveActive(context.execution);
      currentActive();
      await authority.assertCurrent();
      assertArchiveActive(context.execution);
      currentActive();
      await assertCleanupContent(context, measured);
      currentActive();
      await assertCleanupJournalProof(context, measured);
      currentActive();
      const proof: ArchiveCleanupProof = {
        ...measured,
        content: await content.seal(authority),
      };
      await assertCleanupContent(context, proof);
      currentActive();
      await assertCleanupJournalProof(context, proof);
      assertArchiveActive(context.execution);
      currentActive();
      return proof;
    },
  });
}
