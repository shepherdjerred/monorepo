import type { ThreadEvent } from "@openai/codex-sdk";
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
 * Codex authentication is explicit: existing automation can route through an
 * OpenRouter API key, while durable chats pass the complete short-lived
 * ChatGPT subscription auth document. The adapter passes its access token to
 * the official App Server over private stdin with ephemeral credential storage.
 * It never writes subscription credentials into the provider's session home.
 */
export type CodexAgentTurnAuth =
  | {
      readonly kind: "openrouter";
      readonly apiKey: string;
    }
  | {
      readonly kind: "chatgpt-subscription";
      readonly authJson: string;
    };

export type ClaudeAgentTurnAuth = {
  readonly kind: "claude-subscription";
  readonly oauthToken: string;
};

/** A single observed provider event, surfaced to the caller's `onEvent`. */
export type AgentTurnEvent = {
  readonly type: string;
  readonly elapsedMs: number;
  readonly idleMs: number;
};

/**
 * Input shared by both provider adapters. Provider credentials are kept
 * separate from the general child environment so stale or conflicting
 * credential variables cannot silently choose a different auth path.
 */
export type AgentTurnCommonInput = {
  readonly service: string;
  readonly callSite: string;
  readonly prompt: string;
  readonly model: string;
  readonly maxTurns: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly signal: AbortSignal;
  readonly outputSchema?: Record<string, unknown>;
  /** Fail the turn when the provider completes without an agent message. */
  readonly requireFinalText?: boolean;
  /** Retain redacted completed events only for callers that derive evidence. */
  readonly captureEvidenceEvents?: boolean;
  readonly resumeSessionId?: string;
  readonly redactTokens?: readonly (string | undefined)[];
  readonly beforeEvent: () => Promise<boolean>;
  readonly onEvent: (event: AgentTurnEvent) => void;
  readonly warn?: (message: string) => void;
  readonly errorMessagePrefix?: string;
};

export type RunCodexAgentTurnInput = AgentTurnCommonInput & {
  readonly auth: CodexAgentTurnAuth;
  readonly sandboxPolicy: SandboxPolicy;
  readonly turnBudgetKind: TurnBudgetKind;
  readonly skipGitRepoCheck?: boolean;
  /** Optional executable wrapper used to launch the CLI under a provider uid. */
  readonly codexPathOverride?: string;
  /** Return a diagnostic to reject a provider event, or undefined to allow it. */
  readonly eventViolation?: (event: ThreadEvent) => string | undefined;
};

export const ClaudePermissionPolicySchema = z.enum([
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
export type ClaudePermissionPolicy = z.infer<
  typeof ClaudePermissionPolicySchema
>;

export type RunClaudeAgentTurnInput = AgentTurnCommonInput & {
  readonly auth: ClaudeAgentTurnAuth;
  readonly permissionPolicy: ClaudePermissionPolicy;
  /** Original checkpoint's cwd; mandatory when resuming cwd-indexed Claude state. */
  readonly resumeWorkspacePath?: string;
};

export type RunAgentTurnInput =
  | ({ readonly provider: "codex" } & RunCodexAgentTurnInput)
  | ({ readonly provider: "claude" } & RunClaudeAgentTurnInput);

export type AgentTurnUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
};

/**
 * Everything a provider event loop produces before caller-specific output
 * decoding. Usage is normalized across providers and zeroed when a run emits
 * no terminal usage record.
 * `finalText` is the redacted final agent message, or `undefined` when the run
 * produced none — callers decide whether that is an error.
 */
export type AgentTurnOutcome = {
  readonly finalText: string | undefined;
  readonly evidenceEvents: unknown[];
  readonly sessionId: string | undefined;
  readonly usage: AgentTurnUsage;
  readonly numTurns: number;
  readonly generationStarted: boolean;
  readonly possiblyAppliedEffects: boolean;
  readonly durationMs: number;
  readonly eventCount: number;
  readonly firstEventLatencyMs: number | undefined;
  readonly maxIdleMs: number;
};
