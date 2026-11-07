import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  MediaCommandBase,
  type MediaCommandSettings,
} from "#infrastructure/command-base.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  RequestMovieRollbackV1Schema,
  RequestMovieRollbackResultV1Schema,
  type RequestMovieRollbackV1,
} from "#shared/movie-editions/rollback/manual-command.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { readMovieRollbackViewV1 } from "#infrastructure/movie-editions/rollback/read.ts";
import {
  RequestMovieRollbackRetryV1Schema,
  RequestMovieRollbackRetryResultV1Schema,
  type RequestMovieRollbackRetryV1,
} from "#shared/movie-editions/rollback/retry.ts";
import { readMovieRollbackRetryParentV1 } from "#infrastructure/movie-editions/rollback/retry/retry-parent.ts";
import { readMovieRollbackHandoffV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-records.ts";
import { queueMovieRollbackRetryV1 } from "#infrastructure/movie-editions/rollback/retry/retry-command.ts";
import {
  observeClosedMovieRollbackRetryParticipantsV1,
  type ClosedMovieRollbackRetryParticipantV1,
} from "#infrastructure/movie-editions/rollback/retry/retry-pending.ts";
import { observeMovieRollbackClosedOwnerV1 } from "#automation/movie-editions/rollback/closed-owner.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { queueOperation } from "#automation/store.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  captureRequestedMovieRollbackContextV1,
  requestedMovieRollbackConflict,
} from "./manual-context.ts";

function commandInvocation() {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: observed.wall + 60_000,
    guards: [],
  });
  return {
    execution: { observed, ...freshness },
    budget: new PublicationAuthorityReadBudget(),
  };
}

/** Internal owner command. Enqueueing is not Files admission and cannot renew its original pair deadline. */
export class PrismaMovieRollbackCommandsV1 extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    settings: MediaCommandSettings,
    private readonly describe?: MediaAutomationContext["describeWorkflow"],
  ) {
    super(db, settings);
  }

  async read(actor: MediaActor, scope: MovieEditionScope) {
    requireOwner(actor);
    const invocation = commandInvocation();
    if (this.describe === undefined)
      throw new Error(
        "Movie rollback discovery requires the actual Workflow description port",
      );
    const access = await this.configuredMovieChoiceAccess();
    invocation.execution.assertActive();
    return readMovieRollbackViewV1(
      this.db,
      { actorId: actor.id, scope, access, invocation },
      this.describe,
    );
  }

  retry(
    actor: MediaActor,
    key: string,
    raw: RequestMovieRollbackRetryV1,
    beforeNewCommand?: () => Promise<void>,
  ) {
    requireOwner(actor);
    const invocation = commandInvocation();
    const input = RequestMovieRollbackRetryV1Schema.parse(raw);
    let access: MovieChoiceAccess | undefined;
    let closedParticipants: ClosedMovieRollbackRetryParticipantV1[] = [];
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "retry_movie_rollback_v1", input },
        decode: (value) => RequestMovieRollbackRetryResultV1Schema.parse(value),
        beforeNewCommand: async () => {
          await beforeNewCommand?.();
          if (this.describe === undefined)
            throw new Error(
              "Movie rollback retry requires the actual Workflow description port",
            );
          access = await this.configuredMovieChoiceAccess();
          const parent = await readMovieRollbackRetryParentV1(
            this.db,
            input,
            invocation.budget,
          );
          const handoff = await readMovieRollbackHandoffV1(
            this.db,
            parent,
            invocation.budget,
          );
          const closed = await observeMovieRollbackClosedOwnerV1(
            this.describe,
            parent.intent,
            {
              execution: invocation.execution,
              ...(handoff === null ? {} : { owner: handoff.handoff.owner }),
            },
          );
          if (closed.state !== "closed")
            throw requestedMovieRollbackConflict(
              "The exact previous Workflow must be confirmed terminal before retrying",
            );
          closedParticipants =
            await observeClosedMovieRollbackRetryParticipantsV1(this.db, {
              parent,
              describe: this.describe,
              invocation,
            });
        },
        assertCommit: invocation.execution.assertActive,
      },
      async (tx) => {
        if (access === undefined)
          throw new Error(
            "Movie rollback retry lost its captured configuration",
          );
        return queueMovieRollbackRetryV1(tx, {
          actorId: actor.id,
          key,
          command: input,
          access,
          invocation,
          closedParticipants,
        });
      },
    );
  }

  async context(
    actor: MediaActor,
    scope: MovieEditionScope,
    sourceAttemptId: string,
  ) {
    requireOwner(actor);
    const invocation = commandInvocation();
    const access = await this.configuredMovieChoiceAccess();
    invocation.execution.assertActive();
    return this.db.$transaction(
      async (tx) => {
        await bindPlexTransactionDeadline(tx, invocation.execution);
        const captured = await captureRequestedMovieRollbackContextV1(tx, {
          actorId: actor.id,
          scope,
          sourceAttemptId,
          access,
          invocation,
        });
        await bindPlexTransactionDeadline(tx, captured.authority.freshness);
        return captured.context;
      },
      { isolationLevel: "Serializable", timeout: 15_000 },
    );
  }

  async request(
    actor: MediaActor,
    key: string,
    raw: RequestMovieRollbackV1,
    beforeNewCommand?: () => Promise<void>,
  ) {
    requireOwner(actor);
    const invocation = commandInvocation();
    const input = RequestMovieRollbackV1Schema.parse(raw);
    let access: MovieChoiceAccess | undefined;
    let committed: ReturnType<typeof plexBindingFreshness> | undefined;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "request_movie_rollback_v1", input },
        decode: (value) => RequestMovieRollbackResultV1Schema.parse(value),
        beforeNewCommand: async () => {
          await beforeNewCommand?.();
          access = await this.configuredMovieChoiceAccess();
          invocation.execution.assertActive();
        },
        assertCommit: () => committed?.assertActive(),
      },
      async (tx) => {
        if (access === undefined)
          throw new Error("Movie rollback command lost its captured access");
        await bindPlexTransactionDeadline(tx, invocation.execution);
        const captured = await captureRequestedMovieRollbackContextV1(tx, {
          actorId: actor.id,
          scope: input.scope,
          sourceAttemptId: input.sourceAttemptId,
          access,
          invocation,
        });
        if (
          identityHash(input.expected) !==
          identityHash(captured.context.expected)
        )
          throw requestedMovieRollbackConflict(
            "The reviewed movie, binding or original cleanup window changed",
          );
        committed = captured.authority.freshness;
        await bindPlexTransactionDeadline(tx, committed);
        const operationId = await queueOperation(tx, {
          key: `requested-movie-rollback:${actor.id}:${key}`,
          kind: "rollback_movie_edition_v1",
          targetId: input.scope.mediaId,
          userId: actor.id,
          budget: invocation.budget,
          availableAt: new Date(),
          payload: {
            schemaVersion: 1,
            scope: input.scope,
            sourceAttemptId: input.sourceAttemptId,
            mediaId: input.scope.mediaId,
            generation: input.expected.generation,
            recoveryEpoch: input.expected.recoveryEpoch,
            actorId: actor.id,
            source: captured.source,
            request: z.record(z.string(), z.json()).parse(input),
          },
        });
        committed.assertActive();
        return {
          schemaVersion: 1,
          operationId,
          scope: input.scope,
          sourceAttemptId: input.sourceAttemptId,
          status: "queued",
          expiresAt: captured.cleanup.expiresAt.toISOString(),
        };
      },
    );
  }
}
