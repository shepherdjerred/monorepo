import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-settle-v2");

export function reportDareV2BatchFailure(
  stage: "inspect" | "settle",
  dare: { id: number },
  matchId: string,
  error: unknown,
): void {
  logger.error(
    `Could not ${stage} Dare v2 ${dare.id.toString()} for ${matchId}:`,
    error,
  );
  Sentry.captureException(error, {
    tags: {
      source: `betting-dare-v2-${stage}`,
      matchId,
      dareId: dare.id.toString(),
    },
  });
}
