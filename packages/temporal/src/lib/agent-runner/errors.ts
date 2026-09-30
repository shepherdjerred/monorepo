import { ApplicationFailure } from "@temporalio/common";

/**
 * Whether an error message names an authentication, credit, or quota problem.
 * These are terminal for a single agent turn: a Temporal retry would bill the
 * same failing credential again, so callers classify them as non-retryable.
 * Moved verbatim from the two runners this module replaces.
 */
export function isAuthOrQuotaFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return [
    "401 unauthorized",
    "missing bearer",
    "authentication",
    "invalid_api_key",
    "invalid api key",
    "insufficient_quota",
    "usage limit",
    "weekly limit",
    "credits required",
  ].some((needle) => normalized.includes(needle));
}

/**
 * The unified execution error thrown when a Codex agent turn fails. It carries
 * the classification flags each call site needs to decide retryability:
 * whether the model already started generating (billed), whether a tool may
 * already have applied an effect, and whether the failure was auth/quota.
 */
export class AgentTurnExecutionError extends Error {
  readonly provider: string;
  readonly generationStarted: boolean;
  readonly possiblyAppliedEffects: boolean;
  readonly authOrQuotaFailure: boolean;

  constructor(
    message: string,
    input: {
      provider: string;
      generationStarted: boolean;
      possiblyAppliedEffects: boolean;
      authOrQuotaFailure: boolean;
      cause?: unknown;
    },
  ) {
    super(
      message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "AgentTurnExecutionError";
    this.provider = input.provider;
    this.generationStarted = input.generationStarted;
    this.possiblyAppliedEffects = input.possiblyAppliedEffects;
    this.authOrQuotaFailure = input.authOrQuotaFailure;
  }
}

/**
 * Build an {@link AgentTurnExecutionError} from a caught cause, formatting the
 * message with a domain-specific prefix so each call site keeps its exact
 * diagnostic wording, and deriving `authOrQuotaFailure` from the cause.
 */
export function agentTurnExecutionError(input: {
  provider: string;
  cause: unknown;
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
  messagePrefix: string;
}): AgentTurnExecutionError {
  const detail =
    input.cause instanceof Error ? input.cause.message : String(input.cause);
  return new AgentTurnExecutionError(`${input.messagePrefix}: ${detail}`, {
    provider: input.provider,
    generationStarted: input.generationStarted,
    possiblyAppliedEffects: input.possiblyAppliedEffects,
    authOrQuotaFailure: isAuthOrQuotaFailure(input.cause),
    cause: input.cause,
  });
}

/**
 * Turn a generation-started failure into a non-retryable Temporal
 * `ApplicationFailure`. Each domain passes its own `failureTypePrefix` so the
 * emitted `type` keeps that domain's exact typed-failure names —
 * `${prefix}PossiblyAppliedFailure` when a tool may have applied an effect,
 * `${prefix}BilledGenerationFailure` otherwise.
 */
export function nonRetryableGenerationFailure(
  error: AgentTurnExecutionError,
  failureTypePrefix: string,
): ApplicationFailure {
  return ApplicationFailure.create({
    message: error.message,
    cause: error,
    nonRetryable: true,
    type: error.possiblyAppliedEffects
      ? `${failureTypePrefix}PossiblyAppliedFailure`
      : `${failureTypePrefix}BilledGenerationFailure`,
  });
}
