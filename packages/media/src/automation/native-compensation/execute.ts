import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { readCompletedNativeCompensationState } from "#infrastructure/native-compensation/state.ts";
import { discoverNativeCompensationExecution } from "#infrastructure/native-compensation/execution/discovery.ts";
import { assertCompensationDiscovery } from "#infrastructure/native-compensation/execution/discovery-check.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { commitCompensationPhaseCompletion } from "#infrastructure/native-compensation/completion.ts";
import { withPublicationPaths } from "#automation/publication-proof/recording.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import { executePublicationInverse } from "#automation/publication-proof/inverse.ts";
import {
  compensationAuthority,
  assertCompensationAuthorityCurrent,
} from "./authority.ts";
import { measureCompensationExecution } from "./measurement.ts";
import {
  recordCompensationMeasurement,
  compensationRootFreshness,
} from "./record.ts";
import {
  compensationDeadline,
  type CompensationFileContext,
} from "./execution.ts";
import { compensationCompletion } from "./complete.ts";

export async function executeNativeCompensation(
  initial: CompensationFileContext,
  activity: NativeCompensationActivityInput,
): Promise<void> {
  const db = initial.files.db;
  const budget = new PublicationAuthorityReadBudget();
  // Capture once before even the terminal ACK read; no hashing or later phase renews it.
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const original = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(
      initial.execution.expiresAtMs,
      observed.wall + 60_000,
    ),
    guards: [initial.files.execution],
  });
  const execution: PlexBindingExecution = {
    observed,
    expiresAtMs: original.expiresAtMs,
    signal: initial.files.execution.signal,
    assertActive: () => {
      initial.files.execution.signal.throwIfAborted();
      original.assertActive();
    },
    checkpoint: initial.files.execution.checkpoint,
  };
  const settled = await db.$transaction((tx) =>
    readCompletedNativeCompensationState(tx, activity, budget),
  );
  if (settled !== null) return;
  execution.assertActive();
  const discovery = await db.$transaction((tx) =>
    discoverNativeCompensationExecution(tx, activity, { execution, budget }),
  );
  const measurementClock = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(execution.expiresAtMs, discovery.expiresAtMs),
    guards: [execution],
  });
  const measured = await measureCompensationExecution(
    initial,
    discovery,
    measurementClock.assertActive,
  );
  await initial.files.checkpoint("native-compensation-measured");
  measurementClock.assertActive();
  const recorded = await recordCompensationMeasurement(initial, {
    activity,
    execution,
    discovery,
    measured,
    budget,
  });
  if (recorded === null) return;
  const { plex, context, stores, recording } = recorded;
  await context.files.checkpoint("native-compensation-execution-committed");
  await db.$transaction(
    async (tx) => {
      const current = await compensationAuthority(tx, context, activity, plex);
      if (current === null) return;
      assertCompensationDiscovery(tx, current.phase, recorded.discovery, {
        execution,
        budget,
      });
      const deadline = compensationDeadline(context, current.authority.network);
      const assertActive = () => {
        deadline();
        plex.freshness.assertActive();
        execution.assertActive();
      };
      assertActive();
      const physicalFreshness = await compensationRootFreshness(tx, context, {
        activity,
        execution,
        plex,
        kinds: stores.map((store) => store.kind),
      });
      for (const store of stores)
        store.bindAuthority(() => {
          assertActive();
          physicalFreshness.assertActive();
        });
      const operations = recording.operations(async () => {
        await assertCompensationAuthorityCurrent(
          tx,
          context,
          plex,
          current.phase,
        );
        assertActive();
        physicalFreshness.assertActive();
      });
      await withPublicationPaths(
        context.files,
        measured.plan,
        operations,
        async () => {
          await recording.assertCurrent();
          for (const observation of measured.observations)
            await observation.assertUnchanged();
          for (const journal of measured.journals)
            await journal.assertCurrent(recording.state);
          for (const action of recording.actions) {
            const item = operations.find(
              (candidate) => candidate.kind === action.entry.libraryKind,
            );
            if (item === undefined)
              throw new Error("Compensation root executor missing");
            await executePublicationInverse(item.files, action);
          }
          if (recording.state.next !== undefined)
            throw new FileOperationConflict(
              "Compensation inverse is incomplete",
            );
          await recording.assertCurrent();
          for (const journal of measured.journals)
            await journal.assertCurrent(recording.state);
          const completion = await compensationCompletion(
            tx,
            context.files,
            activity,
            { authority: current.authority, state: recording.state },
          );
          await assertCompensationAuthorityCurrent(
            tx,
            context,
            plex,
            current.phase,
          );
          await commitCompensationPhaseCompletion(
            tx,
            { activity, completion },
            current.phase,
            { freshness: physicalFreshness, budget },
          );
          await context.files.checkpoint("native-compensation-before-commit");
          await recording.assertCurrent();
          for (const store of stores) store.assertActive();
          assertPublicationActive(context.files);
          assertActive();
          physicalFreshness.assertActive();
        },
      );
      assertActive();
      physicalFreshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
