import type { ThreadEvent, Usage as CodexUsage } from "@openai/codex-sdk";
import { z } from "zod/v4";

/**
 * In-process contract for the unified agent runner. The runner's input
 * carries non-serializable fields (a redacted child environment, an
 * `AbortSignal`, and event callbacks), so the run request itself is a plain
 * TypeScript type rather than a Zod schema — these values never cross a
 * serialization boundary. The genuinely value-shaped, divergent axes (the
 * sandbox policy and the turn-budget semantics) are validated with Zod so a
 * caller cannot pass an unknown sandbox mode or budget kind.
 */

/**
 * How the runner enforces the `maxTurns` safety budget.
 *
 * - `tool-steps`: Codex reports the whole prompt as one turn, so the budget
 *   counts tool-item starts (the actual agent steps) inside that turn.
 * - `turns`: the budget counts completed Codex turns and trips at the start of
 *   the turn that would exceed it.
 */
export const TurnBudgetKindSchema = z.enum(["tool-steps", "turns"]);
export type TurnBudgetKind = z.infer<typeof TurnBudgetKindSchema>;

/**
 * The Codex sandbox posture for a run. Callers derive this from their own
 * phase/trust policy and pass it in as data; the runner does not decide it.
 */
export const SandboxPolicySchema = z.object({
  sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]),
  networkAccessEnabled: z.boolean(),
  webSearchMode: z.enum(["disabled", "live"]),
});
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;

/**
 * Runner authentication. The discriminated union is intentionally left open so
 * a later PR can add a `chatgpt-subscription` arm; this PR ships OpenRouter
 * only. The key is stripped from the child environment and injected through
 * `codexOptions.apiKey` by the adapter.
 */
export type AgentTurnAuth = {
  readonly kind: "openrouter";
  readonly apiKey: string;
};

/** A single observed provider event, surfaced to the caller's `onEvent`. */
export type AgentTurnEvent = {
  readonly type: string;
  readonly elapsedMs: number;
  readonly idleMs: number;
};

/**
 * Input shared by every in-process Codex caller. Provider credentials are
 * separated from the child environment so the SDK can authenticate without
 * making the inference credential visible to tools.
 */
export type RunAgentTurnInput = {
  readonly service: string;
  readonly callSite: string;
  readonly prompt: string;
  readonly model: string;
  readonly maxTurns: number;
  readonly turnBudgetKind: TurnBudgetKind;
  readonly cwd: string;
  readonly auth: AgentTurnAuth;
  readonly env: Record<string, string>;
  readonly signal: AbortSignal;
  readonly sandboxPolicy: SandboxPolicy;
  readonly outputSchema?: Record<string, unknown>;
  /** Fail the turn when the provider completes without an agent message. */
  readonly requireFinalText?: boolean;
  /** Retain redacted completed events only for callers that derive evidence. */
  readonly captureEvidenceEvents?: boolean;
  readonly redactTokens?: readonly (string | undefined)[];
  readonly beforeEvent: () => Promise<boolean>;
  readonly onEvent: (event: AgentTurnEvent) => void;
  readonly warn?: (message: string) => void;
  readonly errorMessagePrefix?: string;
  /** Return a diagnostic to reject a provider event, or undefined to allow it. */
  readonly eventViolation?: (event: ThreadEvent) => string | undefined;
};

/**
 * Everything the Codex event loop produces, before any caller-specific output
 * decoding. `usage` is the summed raw Codex usage (zeroed when the run emitted
 * no completed turn); each call site projects it into its own token shape.
 * `finalText` is the redacted final agent message, or `undefined` when the run
 * produced none — callers decide whether that is an error.
 */
export type AgentTurnOutcome = {
  readonly finalText: string | undefined;
  readonly evidenceEvents: unknown[];
  readonly sessionId: string | undefined;
  readonly usage: CodexUsage;
  readonly numTurns: number;
  readonly generationStarted: boolean;
  readonly possiblyAppliedEffects: boolean;
  readonly durationMs: number;
  readonly eventCount: number;
  readonly firstEventLatencyMs: number | undefined;
  readonly maxIdleMs: number;
};
