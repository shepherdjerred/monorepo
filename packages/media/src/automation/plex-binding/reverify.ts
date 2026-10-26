import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import {
  preparePlexBindingLockScope,
  lockPlexBindingScope,
  assertPlexBindingExpected,
} from "#infrastructure/plex-binding/authority.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  loadPlexBindingVerificationRequest,
  readPlexBindingVerificationCompletion,
  commitPlexBindingVerification,
} from "#infrastructure/plex-binding/store.ts";
import {
  ReverifyPlexBindingInputSchema,
  ReverifyPlexBindingResultSchema,
  type ReverifyPlexBindingInput,
  type ReverifyPlexBindingResult,
  type PlexBindingExecution,
} from "#shared/plex-binding/activities.ts";
import { bindingAccess } from "./access.ts";

export async function reverifyPlexBinding(
  context: MediaAutomationContext,
  raw: ReverifyPlexBindingInput,
  execution: PlexBindingExecution,
): Promise<ReverifyPlexBindingResult> {
  execution.assertActive();
  const input = ReverifyPlexBindingInputSchema.parse(raw);
  // Historical completion validates its immutable parents, never current configuration.
  const prior = await context.db.$transaction(async (tx) => ({
    request: await loadPlexBindingVerificationRequest(tx, input),
    completion: await readPlexBindingVerificationCompletion(tx, input),
  }));
  execution.assertActive();
  if (prior.completion !== null) {
    return prior.completion;
  }
  try {
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: execution.expiresAtMs,
      guards: [execution],
    });
    const expected = prior.request.expected;
    const access = await bindingAccess(
      context,
      expected.access.map((value) => value.sectionType),
    );
    freshness.assertActive();
    const prepared = await context.db.$transaction(async (tx) => {
      await assertPlexBindingExpected(tx, expected, freshness, { access });
      const scope = await preparePlexBindingLockScope(tx, expected);
      const canonicalTargets = await readPlexCanonicalTargets(
        tx,
        expected.targets.map((value) => value.scope),
      );
      freshness.assertActive();
      return { scope, canonicalTargets };
    });
    const verified = await verifyPlexAssociations(
      context,
      {
        purpose: "current_serving",
        expected,
        canonicalTargets: prepared.canonicalTargets,
        access,
        observed: execution.observed,
        expiresAtMs: freshness.expiresAtMs,
        guards: [freshness],
      },
      execution,
    );
    if ("status" in verified) {
      throw new PlexBindingProtection(verified.reason);
    }
    const result = await serializable(context.db, async (tx) => {
      // A concurrent winner's exact receipt remains an ACK even if current state drifted.
      const completed = await readPlexBindingVerificationCompletion(tx, input);
      execution.assertActive();
      if (completed !== null) {
        return completed;
      }
      await lockPlexBindingScope(tx, prepared.scope, verified.freshness);
      const committed = await commitPlexBindingVerification(tx, {
        input,
        expected,
        verified,
      });
      verified.freshness.assertActive();
      return committed;
    });
    execution.assertActive();
    return ReverifyPlexBindingResultSchema.parse(result);
  } catch (error) {
    execution.assertActive();
    if (!(error instanceof PlexBindingProtection)) {
      throw error;
    }
    const committed = await context.db.$transaction((tx) =>
      readPlexBindingVerificationCompletion(tx, input),
    );
    execution.assertActive();
    if (committed !== null) {
      return committed;
    }
    return error.reason === "scope_changed" ||
      error.reason === "ownership_changed" ||
      error.reason === "binding_changed"
      ? { status: "superseded" }
      : { status: "protected", reason: error.reason };
  }
}
