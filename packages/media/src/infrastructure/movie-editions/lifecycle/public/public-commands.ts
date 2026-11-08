import type { MediaActor } from "#application/auth.ts";
import { MovieEditionCommands } from "#infrastructure/movie-editions/commands.ts";
import { removeMovieChoice } from "#infrastructure/movie-editions/mutations.ts";
import {
  requireMovieProtectionAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  CancelMovieRequestV4Schema,
  CancelMovieRequestResultV4Schema,
  RevokeMovieEditionChoiceV4Schema,
  RevokeMovieEditionChoiceResultV4Schema,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import {
  ActivateMovieEditionChoiceV4Schema,
  ActivateMovieEditionChoiceResultV4Schema,
  type ActivateMovieEditionChoiceV4,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { z } from "zod";
import { activateMovieChoiceV4 } from "#infrastructure/movie-editions/lifecycle/activation.ts";
import { requestedMovieOperationV4 } from "#infrastructure/movie-editions/lifecycle/requested-operation.ts";
import { queueRequestedMovieCaptionsV4 } from "#infrastructure/movie-editions/lifecycle/requested-captions.ts";

/** These commands have distinct idempotency identities from the immutable v3 protocol. */
export class MoviePublicCommandsV4 extends MovieEditionCommands {
  cancelMovieEditionRequestV4(
    actor: MediaActor,
    key: string,
    raw: z.infer<typeof CancelMovieRequestV4Schema>,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = CancelMovieRequestV4Schema.parse(raw);
    const budget = new PublicationAuthorityReadBudget();
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_cancel_v4", input },
        decode: (value) => CancelMovieRequestResultV4Schema.parse(value),
        beforeNewCommand,
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        const result = await removeMovieChoice(tx, actor, input, {
          ...requireMovieProtectionAccess(this.settings),
          protocol: 4,
          budget,
        });
        freshness = result.freshness;
        return CancelMovieRequestResultV4Schema.parse({
          schemaVersion: 4,
          scope: input.scope,
          requestId: input.requestId,
          state: "cancelled",
          choiceId: null,
          applied: {
            targetVersion: result.intent.version,
            requestVersion: result.request.version,
            choiceRevision: result.request.movieEditionChoiceRevision,
          },
        });
      },
    );
  }

  revokeMovieEditionChoiceV4(
    actor: MediaActor,
    key: string,
    raw: z.infer<typeof RevokeMovieEditionChoiceV4Schema>,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = RevokeMovieEditionChoiceV4Schema.parse(raw);
    const budget = new PublicationAuthorityReadBudget();
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_revoke_v4", input },
        decode: (value) => RevokeMovieEditionChoiceResultV4Schema.parse(value),
        beforeNewCommand,
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        const result = await removeMovieChoice(tx, actor, input, {
          ...requireMovieProtectionAccess(this.settings),
          protocol: 4,
          budget,
        });
        freshness = result.freshness;
        return RevokeMovieEditionChoiceResultV4Schema.parse({
          schemaVersion: 4,
          scope: input.scope,
          requestId: input.requestId,
          state: "pending_choice",
          choiceId: null,
          applied: {
            targetVersion: result.intent.version,
            requestVersion: result.request.version,
            choiceRevision: result.request.movieEditionChoiceRevision,
          },
        });
      },
    );
  }

  activateMovieEditionChoiceV4(
    actor: MediaActor,
    key: string,
    raw: ActivateMovieEditionChoiceV4,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = ActivateMovieEditionChoiceV4Schema.parse(raw);
    const budget = new PublicationAuthorityReadBudget();
    let access: MovieChoiceAccess | undefined;
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_choice_activation_v4", input },
        decode: (value) =>
          ActivateMovieEditionChoiceResultV4Schema.parse(value),
        beforeNewCommand: async () => {
          await beforeNewCommand?.();
          access = await this.configuredMovieChoiceAccess();
        },
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        if (access === undefined)
          throw new Error("Movie activation access missing");
        const result = await activateMovieChoiceV4(tx, actor, input, {
          access,
          budget,
        });
        freshness = result.freshness;
        const command = await requestedMovieOperationV4(tx, {
          scope: input.scope,
          generation: result.intent.generation,
          request: result.selected.request,
        });
        const operationId = await this.enqueue(tx, actor, {
          ...command,
          createdAt: new Date(),
          availableAt: new Date(),
        });
        await queueRequestedMovieCaptionsV4(
          tx,
          { scope: input.scope, epoch: result.intent.automationEpoch, access },
          budget,
        );
        return ActivateMovieEditionChoiceResultV4Schema.parse({
          schemaVersion: 4,
          mediaId: input.scope.mediaId,
          subjectUserId: input.subjectUserId,
          edition: input.scope.edition,
          requestId: result.selected.request.id,
          choiceId: result.selected.choice.id,
          state: "queued",
          reason: null,
          operationId,
          applied: {
            mediaVersion: result.media.version,
            targetVersion: result.intent.version,
            requestVersion: result.selected.request.version,
            choiceRevision: result.selected.choice.choiceRevision,
          },
        });
      },
    );
  }
}
