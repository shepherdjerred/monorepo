import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { PlexClient } from "#integrations/plex.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  LibraryPlexEditOperationV3Schema,
  type LibraryPlexEditOperationV3,
} from "#shared/handoff/library-v3.ts";
import {
  PlexEditionIntentV1Schema,
  PlexEditionCompletionV1Schema,
  HandoffObservationRefV1Schema,
  type PlexEditionIntentV1,
} from "#shared/handoff/plex-edition.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { lockHandoffScopes } from "#infrastructure/handoff/scoped-snapshot.ts";
import {
  lockLibraryPlexEditAuthority,
  freshHandoffNetworkV3,
} from "#infrastructure/handoff/plex-edit-authority.ts";
import {
  readPlexEditIntentV1,
  readPlexEditCompletionV1,
  assertNoPendingPlexEdits,
} from "#infrastructure/handoff/plex-edit-records.ts";
import {
  readPlexEditSourcesV1,
  validatePlexEditIntentV1,
  validatePlexEditCompletionV1,
} from "#infrastructure/handoff/plex-edit-history.ts";
import type { readPlexEditHistoryV1 } from "#infrastructure/handoff/plex-edit-history.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  capturePlexEditionSnapshotV1,
  assertPlexEditionReadbackV1,
} from "#migration/handoff-network/plex-edition.ts";

type Context = {
  db: Database;
  plex: Pick<
    PlexClient,
    "machineIdentifier" | "metadataForEditionEdit" | "editMovieEdition"
  >;
  expectedServerMachineId: string;
};
type Input = LibraryPlexEditOperationV3 & {
  filesObservation: { id: string; evidenceHash: string };
};
type History = Awaited<ReturnType<typeof readPlexEditHistoryV1>>;

/** SDK authority is supplied by the Activity entry, never captured by a cached runtime. */
export async function editLibraryPlexEditionV3(
  context: Context,
  raw: Input,
  execution: PlexBindingExecution,
) {
  const input = LibraryPlexEditOperationV3Schema.extend({
    filesObservation: HandoffObservationRefV1Schema,
  }).parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const existing = await context.db.$transaction(async (tx) => {
    const complete = await readPlexEditCompletionV1(tx, input, budget);
    if (complete !== null) {
      await validatePlexEditCompletionV1(tx, complete.evidence, budget);
      return { complete, intent: null };
    }
    return {
      complete: null,
      intent: await readPlexEditIntentV1(tx, input, budget),
    };
  });
  if (existing.complete !== null) return reference(existing.complete.row);
  execution.assertActive();
  execution.signal.throwIfAborted();
  if (existing.intent !== null)
    return reconcile(context, existing.intent, execution, { budget });

  const created = await context.db.$transaction(
    async (tx) => {
      const authority = await lockLibraryPlexEditAuthority(tx, input, budget);
      await assertNoPendingPlexEdits(tx, [authority.file], budget);
      const sources = await readPlexEditSourcesV1(
        tx,
        {
          binding: input,
          planHash: authority.planHash,
          epoch: authority.runtime.recoveryEpoch,
          files: input.filesObservation,
        },
        budget,
      );
      const network = await freshHandoffNetworkV3(
        tx,
        {
          planId: input.planId,
          epoch: authority.runtime.recoveryEpoch,
          reference: sources.files.networkObservation,
        },
        budget,
      );
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          execution.expiresAtMs,
          sources.row.expiresAt.getTime(),
          network.row.expiresAt.getTime(),
        ),
        guards: [execution],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const before = await snapshot(context, authority, execution, budget);
      freshness.assertActive();
      if (before.identityHash !== authority.change.identityHash)
        throw new Error("Plex edition identity changed after review");
      const binding = {
        schemaVersion: 1,
        planId: input.planId,
        operationId: input.operationId,
        assetId: input.assetId,
        recoveryEpoch: authority.runtime.recoveryEpoch,
        planHash: authority.plan.planHash,
        changeHash: identityHash(authority.change),
        observedAt: new Date(execution.observed.wall).toISOString(),
        sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
        filesObservation: input.filesObservation,
        networkObservation: sources.files.networkObservation,
      };
      if ((before.editionTitle ?? "") === authority.change.targetEditionTitle) {
        assertPlexEditionReadbackV1(
          before,
          before,
          authority.change.scope.edition,
        );
        const completion = PlexEditionCompletionV1Schema.parse({
          ...binding,
          before,
          after: before,
          intent: null,
          response: "not_sent",
        });
        await validatePlexEditCompletionV1(tx, completion, budget);
        return {
          completion: await append(tx, "plex_edit_completion_v1", completion),
          intent: null,
        };
      }
      const intent = PlexEditionIntentV1Schema.parse({ ...binding, before });
      await validatePlexEditIntentV1(tx, intent, budget);
      freshness.assertActive();
      return {
        completion: null,
        intent: {
          row: await append(tx, "plex_edit_intent_v1", intent),
          evidence: intent,
        },
      };
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  if (created.completion !== null) return reference(created.completion);

  // This invocation alone may send the new intent. Every subsequent invocation only observes it.
  let acknowledged = false;
  let sent = false;
  await context.db
    .$transaction(
      async (tx) => {
        const authority = await lockLibraryPlexEditAuthority(tx, input, budget);
        const original = created.intent.evidence;
        const freshness = plexBindingFreshness({
          observed: execution.observed,
          expiresAtMs: Math.min(
            execution.expiresAtMs,
            Date.parse(original.expiresAt),
          ),
          guards: [execution],
        });
        await freshHandoffNetworkV3(
          tx,
          {
            planId: input.planId,
            epoch: authority.runtime.recoveryEpoch,
            reference: original.networkObservation,
          },
          budget,
        );
        await bindPlexTransactionDeadline(tx, freshness);
        const current = await snapshot(context, authority, execution, budget);
        if (
          current.identityHash !== original.before.identityHash ||
          (current.editionTitle ?? "") !== (original.before.editionTitle ?? "")
        )
          throw new Error(
            "Plex edition metadata changed before the guarded write",
          );
        freshness.assertActive();
        sent = true;
        await context.plex.editMovieEdition(
          {
            sectionId: original.before.identity.sectionId,
            ratingKey: original.before.identity.ratingKey,
            edition: authority.change.scope.edition,
          },
          execution.signal,
        );
        acknowledged = true;
        freshness.assertActive();
      },
      { timeout: 30_000, maxWait: 30_000 },
    )
    .catch((error: unknown) => {
      // A sent request may have completed despite an unreadable response; retain its durable intent.
      if (!sent || execution.signal.aborted) throw error;
    });
  return reconcile(context, created.intent, execution, {
    budget,
    acknowledged,
  });
}

async function snapshot(
  context: Context,
  history: Pick<History, "scope" | "file" | "change">,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
) {
  execution.assertActive();
  const serverMachineId = await context.plex.machineIdentifier(
    execution.signal,
  );
  if (
    serverMachineId !== context.expectedServerMachineId ||
    serverMachineId !== history.change.identity.serverMachineId
  )
    throw new Error("Plex edition server identity changed");
  const media = await context.db.mediaItem.findUniqueOrThrow({
    where: { id: history.change.scope.mediaId },
  });
  budget.consume(1);
  const item = await context.plex.metadataForEditionEdit(
    history.change.identity.ratingKey,
    execution.signal,
  );
  execution.assertActive();
  const result = capturePlexEditionSnapshotV1(item, {
    serverMachineId,
    sectionId: history.change.identity.sectionId,
    media,
    canonicalPath: history.file.canonicalPath,
    sizeBytes: history.file.sizeBytes,
  });
  if (
    (await context.plex.machineIdentifier(execution.signal)) !== serverMachineId
  )
    throw new Error("Plex edition server changed during observation");
  return result;
}

async function reconcile(
  context: Context,
  intent: {
    row: { id: string; evidenceHash: string };
    evidence: PlexEditionIntentV1;
  },
  execution: PlexBindingExecution,
  options: { budget: PublicationAuthorityReadBudget; acknowledged?: boolean },
) {
  const { budget, acknowledged = false } = options;
  execution.assertActive();
  return context.db.$transaction(
    async (tx) => {
      const history = await validatePlexEditIntentV1(
        tx,
        intent.evidence,
        budget,
      );
      await lockHandoffScopes(tx, history.scope);
      await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id=${history.plan.id} FOR UPDATE`;
      const previous = await readPlexEditCompletionV1(
        tx,
        intent.evidence,
        budget,
      );
      if (previous !== null) {
        await validatePlexEditCompletionV1(tx, previous.evidence, budget);
        return reference(previous.row);
      }
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: execution.expiresAtMs,
        guards: [execution],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const after = await snapshot(context, history, execution, budget);
      assertPlexEditionReadbackV1(
        intent.evidence.before,
        after,
        history.change.scope.edition,
      );
      const completion = PlexEditionCompletionV1Schema.parse({
        ...intent.evidence,
        observedAt: new Date(execution.observed.wall).toISOString(),
        sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
        intent: reference(intent.row),
        after,
        response: acknowledged ? "acknowledged" : "lost_or_unobserved",
      });
      await validatePlexEditCompletionV1(tx, completion, budget);
      freshness.assertActive();
      return reference(await append(tx, "plex_edit_completion_v1", completion));
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function append(
  tx: Prisma.TransactionClient,
  kind: string,
  evidence: { planId: string; observedAt: string; expiresAt: string },
) {
  return tx.mediaHandoffObservation.create({
    data: {
      planId: evidence.planId,
      kind,
      evidence: z.record(z.string(), z.json()).parse(nativeJson(evidence)),
      evidenceHash: identityHash(evidence),
      observedAt: new Date(evidence.observedAt),
      expiresAt: new Date(evidence.expiresAt),
    },
  });
}
function reference(row: { id: string; evidenceHash: string }) {
  return { id: row.id, evidenceHash: row.evidenceHash };
}
