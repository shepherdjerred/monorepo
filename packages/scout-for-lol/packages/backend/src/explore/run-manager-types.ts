import type {
  DiscordAccountId,
  ExploreActiveRun,
  ExploreMessage,
  ExploreStreamEvent,
  ExploreTraceEntry,
  ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import type {
  ExploreAgentParams,
  ExploreAgentResult,
} from "#src/explore/agent.ts";
import type {
  ExploreRateLimitIdentity,
  ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";

export type RunTermination = "stop" | "delete" | "shutdown" | null;
export type Subscriber = (event: ExploreStreamEvent) => void;
export type ExploreAgentRunner = (
  params: ExploreAgentParams,
) => Promise<ExploreAgentResult>;

export type StartedTurn = {
  conversationId: string;
  title: string;
  messageId: string;
  question: string;
  expectedCurrentLeafId: string | null;
  previousCurrentLeafId: string | null;
  createdConversation: boolean;
  createdQuestion: boolean;
};

/**
 * The live progress a durable observer needs to reconstruct a run.
 *
 * Mirrored onto the run row by the Temporal Activity's heartbeat, because a
 * client's SSE request does not necessarily reach the process that owns the
 * run. Anything missing from this shape is something that observer has to
 * invent — which is what used to make the same run show a real status line on
 * one path and a fabricated "Thinking…" on the other.
 */
export type ExploreRunProgress = {
  answer: string;
  trace: ExploreTraceEntry[];
  activity: string | null;
  preview: ReportAiPreviewSummary | null;
};

export type ActiveRun = {
  summary: ExploreActiveRun;
  identity: ExploreRateLimitIdentity;
  guildIds: string[];
  ticket: ExploreRateLimitTicket;
  started: StartedTurn;
  history: ExploreMessage[];
  abortController: AbortController;
  subscribers: Set<Subscriber>;
  answer: string;
  activity: string | null;
  trace: ExploreTraceEntry[];
  /**
   * The latest query result this turn produced, retained purely so a
   * reconnect snapshot can carry it. Last write wins, matching the agent's
   * own `lastPreview`, so a reconnecting reader never sees an earlier
   * query's table beside a later query's answer.
   */
  preview: ReportAiPreviewSummary | null;
  termination: RunTermination;
  settled: Promise<null>;
  resolveSettled: (value: null) => void;
};

export type TerminalRun = {
  userId: DiscordAccountId;
  outcome: "succeeded" | "stopped" | "interrupted" | "failed";
  completedAt: number;
};
