import type { FileContext } from "#automation/files/types.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import { prepareRecordedPublicationProof } from "#automation/publication-proof/embedded.ts";
import { compensateRecordedPublication } from "#automation/publication-proof/local-compensation.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";

/** A fresh eligibility refusal cannot strand an exact recorded, uncommitted effect. */
export async function compensateRejectedChoice(
  context: FileContext,
  attemptId: string,
  error: unknown,
) {
  if (!(error instanceof MovieChoiceProtection)) return;
  const intent = await loadPublicationIntent(context.db, attemptId);
  if (intent === null) return;
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  if (["imported", "completed", "obsolete"].includes(attempt.state)) return;
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const prepared = await prepareRecordedPublicationProof(
    publicationInvocation(
      context,
      requirePublicationExecution(context.publicationExecution?.()),
    ),
    plan,
    attemptId,
  );
  await compensateRecordedPublication(prepared, attemptId, plan);
}
