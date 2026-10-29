import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { verifyMoviePlexV2 } from "#automation/movie-editions/plex-verification.ts";
import {
  LibraryPlexBindingInputV1Schema,
  type LibraryPlexBindingInputV1,
  type PlexBindingExecution,
  type ReverifyPlexBindingResult,
} from "#shared/plex-binding/activities.ts";
import { captureLibraryPlexExpectedV2 } from "#infrastructure/plex-binding/library/authority.ts";
import {
  loadLibraryPlexRequest,
  readLibraryPlexCompletion,
} from "#infrastructure/plex-binding/library/records.ts";
import { commitLibraryPlexBinding } from "#infrastructure/plex-binding/library/commit.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindingAccess } from "./access.ts";
import { queueReadyMovieCaptionNoticesV4 } from "#automation/movie-editions/notifications/captions.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

/** SDK observation precedes lazy initialization; immutable ACK precedes current authority and Plex I/O. */
export async function verifyLibraryPlexBinding(
  context: MediaAutomationContext,
  raw: LibraryPlexBindingInputV1,
  execution: PlexBindingExecution,
): Promise<ReverifyPlexBindingResult> {
  execution.assertActive();
  const input = LibraryPlexBindingInputV1Schema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const original = await context.db.$transaction(async (tx) => {
    const request = await loadLibraryPlexRequest(tx, input, budget);
    const completion = await readLibraryPlexCompletion(
      tx,
      input,
      request,
      budget,
    );
    return { request, completion };
  });
  execution.assertActive();
  if (original.completion !== null)
    return {
      status: "verified",
      bindingCount: original.completion.bindings.length,
    };
  try {
    const kind =
      original.request.parent.file.libraryKind === "movies" ? "movie" : "show";
    const access = await bindingAccess(context, [kind]);
    const capture = await context.db.$transaction((tx) =>
      captureLibraryPlexExpectedV2(
        tx,
        {
          command: input,
          parent: original.request.parent,
          birth: original.request.birth,
          access,
        },
        budget,
      ),
    );
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(execution.expiresAtMs, capture.writerExpiresAtMs),
      guards: [execution],
    });
    const verificationInput = {
      purpose: "current_serving" as const,
      expected: capture.expected,
      canonicalTargets: capture.canonicalTargets,
      access,
      observed: execution.observed,
      expiresAtMs: freshness.expiresAtMs,
      guards: [freshness],
    };
    const verified = await (kind === "movie"
      ? verifyMoviePlexV2(context, verificationInput, execution)
      : verifyPlexAssociations(context, verificationInput, execution));
    if ("status" in verified) throw new PlexBindingProtection(verified.reason);
    const refreshedAccess = await bindingAccess(context, [kind]);
    verified.freshness.assertActive();
    if (identityHash(refreshedAccess) !== identityHash(access))
      throw new PlexBindingProtection("wrong_section");
    const { freshness: guarded, ...observation } = verified;
    const receipt = await serializable(context.db, async (tx) => {
      const completed = await commitLibraryPlexBinding(
        tx,
        {
          input,
          request: original.request,
          expected: capture.expected,
          observation,
          freshness: guarded,
          execution,
          writerExpiresAtMs: capture.writerExpiresAtMs,
        },
        budget,
      );
      const server = access[0];
      if (kind === "movie") {
        if (server === undefined)
          throw new Error("Library movie serving access missing");
        const notices = await queueReadyMovieCaptionNoticesV4(
          tx,
          {
            scope: MovieEditionScopeSchema.parse({
              mediaId: original.request.parent.asset.editionRootId,
              rootMediaId: original.request.parent.asset.editionRootId,
              edition: original.request.parent.asset.edition,
            }),
            assetId: input.assetId,
            epoch: input.recoveryEpoch,
            access: {
              serverMachineId: server.serverMachineId,
              movieSectionId: server.sectionId,
            },
          },
          budget,
        );
        for (const guard of notices.guards) guard.assertActive();
      }
      guarded.assertActive();
      return completed;
    });
    execution.assertActive();
    return { status: "verified", bindingCount: receipt.bindings.length };
  } catch (error) {
    execution.assertActive();
    if (!(error instanceof PlexBindingProtection)) throw error;
    const completed = await context.db.$transaction((tx) =>
      readLibraryPlexCompletion(tx, input, original.request, budget),
    );
    execution.assertActive();
    if (completed !== null)
      return { status: "verified", bindingCount: completed.bindings.length };
    return error.reason === "scope_changed" ||
      error.reason === "ownership_changed" ||
      error.reason === "binding_changed"
      ? { status: "superseded" }
      : { status: "protected", reason: error.reason };
  }
}
