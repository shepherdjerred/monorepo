import type { MediaAutomationContext } from "#automation/context.ts";
import type { Operation } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieRetryPlexCaptureV1Schema,
  MovieRetryPlexAcknowledgementV1Schema,
} from "#shared/movie-editions/retry/v2.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { movieRetryBirthHash } from "#infrastructure/movie-editions/lifecycle/retry/retry-source.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { finalizeMovieAcquisitionV4 } from "#automation/movie-editions/finalization.ts";
import { movieRetryTerminalV1 } from "#automation/movie-editions/retry/terminal.ts";
import {
  commitMovieRetryPlexAcknowledgementV1,
  readMovieRetryPlexAcknowledgementV1,
} from "#infrastructure/movie-editions/lifecycle/retry/retry-plex-acknowledgement.ts";
import { serializable } from "#automation/store.ts";

/** Committed serving history retains its original coordinator and exact original finalization input. */
export async function reconcileCommittedMovieRetryV1(
  context: MediaAutomationContext,
  input: { command: MovieOperationV4; operation: Operation; capture: unknown },
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie historical recovery requires its original execution and allowance",
    );
  const { budget, execution } = invocation;
  const captured = MovieRetryPlexCaptureV1Schema.parse(input.capture);
  execution.assertActive();
  const receipt = await readMoviePlexReceiptV2(
    context.db,
    captured.originalInput,
    budget,
  );
  if (
    receipt === null ||
    identityHash(receipt) !== captured.originalReceiptHash ||
    receipt.command.payloadHash !== captured.originalCommandHash ||
    identityHash(input.command.scope) !==
      identityHash(captured.originalInput.scope) ||
    input.command.generation !== captured.generation ||
    receipt.expected.targets[0]?.generation !== captured.generation
  )
    throw new Error(
      "Movie historical retry lost its actual original committed Plex command",
    );
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: captured.originalInput.attemptId },
  });
  budget.consume(1);
  if (
    movieRetryBirthHash(attempt) !== captured.birthHash ||
    attempt.coordinatorOperationId !== captured.originalInput.operationId ||
    attempt.recoveryEpoch !== captured.recoveryEpoch
  )
    throw new Error(
      "Movie historical retry changed its actual committed acquisition parent",
    );
  execution.assertActive();
  const previous = readMovieRetryPlexAcknowledgementV1(
    input.operation.result,
    input.command,
    captured,
  );
  if (previous !== null) return acknowledgementResult(previous.kind);
  if (attempt.state === "completed") {
    const proof = await serializable(context.db, (tx) =>
      commitMovieRetryPlexAcknowledgementV1(
        tx,
        {
          proof: MovieRetryPlexAcknowledgementV1Schema.parse({
            schemaVersion: 1,
            command: input.command,
            originalInput: captured.originalInput,
            originalReceiptHash: captured.originalReceiptHash,
            originalCommandHash: captured.originalCommandHash,
            kind: "historical_ack",
            terminal: null,
            completed: true,
          }),
          capture: captured,
        },
        budget,
        execution,
      ),
    );
    execution.assertActive();
    return acknowledgementResult(proof.kind);
  }
  if (attempt.state !== "imported")
    throw new Error(
      "Committed Plex recovery lost its actual published physical phase",
    );
  const terminal = await movieRetryTerminalV1(
    context,
    {
      attemptId: attempt.id,
      previousCoordinatorOperationId: captured.originalInput.operationId,
      reservedWithoutTorrent: false,
    },
    execution,
  );
  if (terminal === null)
    return {
      status: "waiting" as const,
      attemptId: null,
      reason: "movie_retry_previous_workflow_not_closed",
    };
  await finalizeMovieAcquisitionV4(
    context,
    captured.originalInput,
    execution,
    true,
  );
  execution.assertActive();
  const proof = await serializable(context.db, (tx) =>
    commitMovieRetryPlexAcknowledgementV1(
      tx,
      {
        proof: MovieRetryPlexAcknowledgementV1Schema.parse({
          schemaVersion: 1,
          command: input.command,
          originalInput: captured.originalInput,
          originalReceiptHash: captured.originalReceiptHash,
          originalCommandHash: captured.originalCommandHash,
          kind: "finalization",
          terminal,
          completed: true,
        }),
        capture: captured,
      },
      budget,
      execution,
    ),
  );
  execution.assertActive();
  return acknowledgementResult(proof.kind);
}

function acknowledgementResult(kind: "historical_ack" | "finalization") {
  return {
    status: "available" as const,
    attemptId: null,
    reason:
      kind === "historical_ack"
        ? "historical_plex_completion"
        : "historical_plex_finalization",
  };
}
