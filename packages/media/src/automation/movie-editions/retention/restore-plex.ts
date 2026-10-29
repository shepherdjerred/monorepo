import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { readMovieRestorePlexReceiptV1 } from "#infrastructure/movie-editions/retention/restore-plex-receipt.ts";
import { captureMovieRestorePlexExpectedV1 } from "#infrastructure/movie-editions/retention/restore-plex-expected.ts";
import { commitMovieRestorePlexV1 } from "#infrastructure/movie-editions/retention/restore-plex-commit.ts";
import { verifyMoviePlexV2 } from "#automation/movie-editions/plex-verification.ts";
import { plexRead } from "#automation/publication/association/io.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";

type Result = {
  status: "available" | "waiting" | "blocked" | "obsolete";
  reason: string | null;
};

/** Rebind actual restored bytes without manufacturing an acquisition or resetting their original publication clock. */
export async function publishRestoredMovieToPlexV4(
  base: MediaAutomationContext,
  raw: MovieOperationV4,
  execution: PlexBindingExecution,
): Promise<Result> {
  execution.assertActive();
  execution.signal.throwIfAborted();
  const initial = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  const context = {
    ...initial,
    plexBindingExecution: () => execution,
    movieManagement: { ...initial.movieManagement, execution },
  };
  const invocation = context.movieManagement;
  const input = MovieOperationV4Schema.parse(raw);
  if (await readMovieRestorePlexReceiptV1(context.db, input, invocation.budget))
    return { status: "available", reason: null };
  try {
    if (!(await context.gates.acquisition()))
      return { status: "blocked", reason: "acquisition_disabled" };
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.mediaId])) ?? {},
    );
    const prepared = await context.db.$transaction((tx) =>
      captureMovieRestorePlexExpectedV1(tx, {
        command: input,
        access,
        invocation,
      }),
    );
    prepared.freshness.assertActive();
    execution.assertActive();
    await plexRead(
      { plex: context.plex, execution, freshness: prepared.freshness },
      () => context.plex.refresh(access.movieSectionId, execution.signal),
      "wrong_section",
    );
    const verified = await verifyMoviePlexV2(
      context,
      {
        purpose: "current_serving",
        expected: prepared.expected,
        canonicalTargets: prepared.canonicalTargets,
        access: prepared.expected.access,
        observed: execution.observed,
        expiresAtMs: prepared.freshness.expiresAtMs,
        guards: [prepared.freshness],
      },
      execution,
    );
    if ("status" in verified)
      return { status: "waiting", reason: verified.reason };
    const configured = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.mediaId])) ?? {},
    );
    if (identityHash(configured) !== identityHash(access))
      throw new PlexBindingProtection("wrong_section");
    await context.db.$transaction(
      async (tx) => {
        await lockMovieCommand(tx, input.scope);
        await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
        if (await readMovieRestorePlexReceiptV1(tx, input, invocation.budget))
          return;
        if (!(await context.gates.acquisition()))
          throw new PlexBindingProtection("scope_changed");
        await commitMovieRestorePlexV1(tx, {
          command: input,
          access,
          expected: prepared.expected,
          verified,
          invocation,
        });
        verified.freshness.assertActive();
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "available", reason: null };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (
      !(error instanceof PlexBindingProtection) &&
      !(error instanceof MovieChoiceProtection)
    )
      throw error;
    if (
      await readMovieRestorePlexReceiptV1(context.db, input, invocation.budget)
    )
      return { status: "available", reason: null };
    return {
      status:
        error instanceof MovieChoiceProtection ||
        error.reason === "scope_changed" ||
        error.reason === "ownership_changed"
          ? "obsolete"
          : "waiting",
      reason:
        error instanceof MovieChoiceProtection ? error.code : error.reason,
    };
  }
}
