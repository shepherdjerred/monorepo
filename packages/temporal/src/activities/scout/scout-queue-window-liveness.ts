import { Context } from "@temporalio/activity";
import { AISDKError, generateText } from "ai";
import { z } from "zod/v4";
import { costForTextUsage } from "@shepherdjerred/llm-models";
import {
  generateValidatedObject,
  parseNativeUsage,
  StructuredOutputUsageError,
  webSearchTool,
  type AggregateLlmUsage,
  type LlmCallMetadata,
  type TokenBreakdown,
} from "@shepherdjerred/llm-runtime";
import { temporalLlmRuntime } from "#activities/agent/synthesis-runtime.ts";
import { riotSourceFamily } from "./riot-source-family.ts";
import {
  queueWarningFinding,
  type QueueWindowsReport,
} from "./scout-queue-windows-report.ts";

/**
 * LLM-assisted liveness check for queues the drift engine reports as
 * `sparse-no-close`: an open-ended window with zero tracked matches. Sparse
 * evidence cannot distinguish "the mode ended" from "tracked players do not
 * play it", so a research call with web search asks the model, and a
 * deterministic guard decides whether to believe it.
 *
 * The model only proposes. `live` is accepted only when it cites a Riot or
 * League wiki page that its own web search actually returned; everything else
 * keeps the warning active.
 */

/** OpenAI only: the Scout worker holds no other provider credential. */
export const QUEUE_LIVENESS_MODEL = "gpt-5.6-sol";
export const QUEUE_LIVENESS_RESEARCH_WORKLOAD =
  "scout.queue-window-liveness.research";
export const QUEUE_LIVENESS_FINALIZE_WORKLOAD =
  "scout.queue-window-liveness.finalize";
/** Honoured by Anthropic only; OpenAI decides its own search count. */
const MAX_WEB_SEARCHES = 5;
const RESEARCH_MAX_OUTPUT_TOKENS = 8192;
const FINALIZE_MAX_OUTPUT_TOKENS = 4096;
const RESEARCH_TIMEOUT_MS = 4 * 60_000;
const FINALIZE_TIMEOUT_MS = 2 * 60_000;
const MAX_RESEARCH_EVIDENCE_CHARS = 20_000;
const MAX_PATCH_NOTES = 12;
const MAX_RATIONALE_CHARS = 600;
const MAX_SOURCES = 8;

export type QueueLivenessStatus = "live" | "ended" | "unknown";

export type QueueLivenessUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  webSearchRequests: number;
  /** Catalog price of both calls' tokens, excluding per-request search fees. */
  tokenCostUsd: number;
  /** Absent when the catalog cannot price a billed dimension honestly. */
  costUsd?: number;
};

export type QueueLivenessCheck = {
  findingId: string;
  queue: string;
  status: QueueLivenessStatus;
  rationale: string;
  sources: string[];
  endedOn?: string;
  /** The model proposed `live`, but no cited allowlisted page came from its search. */
  unsupportedLive?: boolean;
  /** An LLM boundary failure; the status is `unknown` and the warning stays active. */
  errorClass?: string;
  usage?: QueueLivenessUsage;
};

export const QueueLivenessVerdictSchema = z.strictObject({
  status: z.enum(["live", "ended", "unknown"]),
  // Nullable rather than optional: strict structured outputs require every key.
  endedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  rationale: z.string().min(1),
  sources: z.array(z.string()),
});
export type QueueLivenessVerdict = z.infer<typeof QueueLivenessVerdictSchema>;

export type QueueLivenessInput = {
  findingId: string;
  queue: string;
  window: { start: string; note?: string | undefined } | undefined;
  patchNotes: QueueWindowsReport["patchNotes"];
  lookbackDays: number;
  /** YYYY-MM-DD, the activity's observation date. */
  today: string;
  abortSignal?: AbortSignal | undefined;
};

type LlmCallInput = {
  system: string;
  prompt: string;
  abortSignal: AbortSignal;
};

export type QueueLivenessResearch = {
  text: string;
  /** URLs the provider's web search returned, as reported by the SDK. */
  sources: string[];
  metadata: LlmCallMetadata;
};

export type QueueLivenessFinalization = {
  verdict: QueueLivenessVerdict;
  usage: AggregateLlmUsage;
};

/** Seams for the two LLM calls so the guard is testable without a provider. */
export type QueueLivenessLlm = {
  research: (input: LlmCallInput) => Promise<QueueLivenessResearch>;
  finalize: (input: LlmCallInput) => Promise<QueueLivenessFinalization>;
};

// OpenAI reports server-side searches in response content, not usage.
const ProviderExecutedWebSearchSchema = z.looseObject({
  type: z.literal("tool-call"),
  toolName: z.literal("web_search"),
  providerExecuted: z.literal(true),
});

function providerExecutedWebSearches(content: readonly unknown[]): number {
  return content.filter(
    (part) => ProviderExecutedWebSearchSchema.safeParse(part).success,
  ).length;
}

export const runtimeQueueLivenessLlm: QueueLivenessLlm = {
  async research(input) {
    const llm = temporalLlmRuntime();
    const result = await generateText({
      model: llm.languageModel(QUEUE_LIVENESS_MODEL, ["tools", "webSearch"]),
      system: input.system,
      prompt: input.prompt,
      tools: {
        web_search: webSearchTool(llm, QUEUE_LIVENESS_MODEL, MAX_WEB_SEARCHES),
      },
      maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
      maxRetries: 2,
      abortSignal: input.abortSignal,
      ...llm.callOptions({
        workload: QUEUE_LIVENESS_RESEARCH_WORKLOAD,
        model: QUEUE_LIVENESS_MODEL,
      }),
    });
    return {
      text: result.text,
      sources: result.sources.flatMap((source) =>
        source.sourceType === "url" ? [source.url] : [],
      ),
      metadata: parseNativeUsage({
        requestedModel: QUEUE_LIVENESS_MODEL,
        provider: llm.providerFor(QUEUE_LIVENESS_MODEL).provider,
        providerExecutedWebSearchRequests: providerExecutedWebSearches(
          result.steps.flatMap((step) => step.content),
        ),
        responseId: result.finalStep.response.id,
        resolvedModel: result.finalStep.response.modelId,
        usage: result.usage,
      }),
    };
  },
  async finalize(input) {
    const result = await generateValidatedObject(temporalLlmRuntime(), {
      model: QUEUE_LIVENESS_MODEL,
      schema: QueueLivenessVerdictSchema,
      schemaName: "queue_liveness_verdict",
      system: input.system,
      prompt: input.prompt,
      workload: QUEUE_LIVENESS_FINALIZE_WORKLOAD,
      maxOutputTokens: FINALIZE_MAX_OUTPUT_TOKENS,
      reasoningEffort: "low",
      abortSignal: input.abortSignal,
    });
    return { verdict: result.object, usage: result.usage };
  },
};

/**
 * Compare URLs by what they address: tracking parameters, fragments, and a
 * trailing slash do not make a cited page different from a searched one.
 */
export function normalizeSourceUrl(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }
  const query = new URLSearchParams(
    [...parsed.searchParams].filter(
      ([key]) => !key.toLowerCase().startsWith("utm_"),
    ),
  ).toString();
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.hostname}${path}${query === "" ? "" : `?${query}`}`;
}

/**
 * The deterministic guard. `live` stands only when at least one cited URL is
 * on the Riot/wiki allowlist and was returned by the research call's own web
 * search, so a remembered or invented link cannot clear a warning.
 */
export function acceptLivenessVerdict(
  verdict: QueueLivenessVerdict,
  researchSources: readonly string[],
): Pick<QueueLivenessCheck, "status" | "sources" | "unsupportedLive"> {
  const searched = new Set(
    researchSources
      .map((url) => normalizeSourceUrl(url))
      .filter((url) => url !== undefined),
  );
  const sources = [
    ...new Set(
      verdict.sources.filter((url) => normalizeSourceUrl(url) !== undefined),
    ),
  ].slice(0, MAX_SOURCES);
  if (verdict.status !== "live") {
    return { status: verdict.status, sources };
  }
  const supported = sources.some((url) => {
    const normalized = normalizeSourceUrl(url);
    return (
      normalized !== undefined &&
      riotSourceFamily(url) !== undefined &&
      searched.has(normalized)
    );
  });
  return supported
    ? { status: "live", sources }
    : { status: "unknown", sources, unsupportedLive: true };
}

function patchNoteLines(patchNotes: QueueWindowsReport["patchNotes"]): string {
  if ("error" in patchNotes) {
    return `Patch-note listing unavailable: ${patchNotes.error}`;
  }
  return patchNotes.titles.length === 0
    ? "No recent patch notes listed."
    : patchNotes.titles
        .slice(0, MAX_PATCH_NOTES)
        .map((note) => `- ${note.title}: ${note.url}`)
        .join("\n");
}

const RESEARCH_SYSTEM = [
  "You verify whether a League of Legends queue (game mode) is currently playable.",
  "Use web search. Prefer official Riot pages (leagueoflegends.com news and patch notes, support-leagueoflegends.riotgames.com) and the League of Legends wiki (wiki.leagueoflegends.com).",
  "Report concise factual evidence, including any announced end, rotation-out, or removal date, with the URL of every page that supports each statement.",
  "Do not guess; say plainly when the evidence is missing or conflicting.",
].join(" ");

export function livenessResearchPrompt(input: QueueLivenessInput): string {
  const window =
    input.window === undefined
      ? "No open window was found in queue-windows.json."
      : `Recorded availability window: started ${input.window.start}, no end recorded.${input.window.note === undefined ? "" : ` Note: ${input.window.note}`}`;
  return [
    `Today is ${input.today}.`,
    `Queue: "${input.queue}" (Scout's internal name for a League of Legends queue).`,
    window,
    `Scout observed no matches for this queue among its tracked players over the last ${input.lookbackDays.toString()} days. That may only mean those players do not play it.`,
    "Recent official patch notes:",
    patchNoteLines(input.patchNotes),
    "",
    "Question: is this mode still available to play in League of Legends today? If it ended or was removed, when was the last playable date?",
  ].join("\n");
}

const FINALIZE_SYSTEM = [
  "Convert research evidence about a League of Legends queue into a verdict object.",
  'status "live": the evidence shows the mode is playable as of today.',
  'status "ended": the evidence shows the mode was removed or its limited run finished; set endedOn to the last playable or removal date when stated, otherwise null.',
  'status "unknown": the evidence is missing, stale, or conflicting.',
  "sources: cite only URLs from the research source list, preferring Riot and League wiki pages. Never invent a URL.",
  "rationale: one or two sentences naming the decisive evidence.",
].join(" ");

function finalizePrompt(
  input: QueueLivenessInput,
  research: QueueLivenessResearch,
): string {
  const sources =
    research.sources.length === 0
      ? "(web search returned no sources)"
      : research.sources.map((url) => `- ${url}`).join("\n");
  return [
    livenessResearchPrompt(input),
    "",
    "Research evidence:",
    research.text.slice(-MAX_RESEARCH_EVIDENCE_CHARS),
    "",
    "Research source list:",
    sources,
  ].join("\n");
}

const NO_USAGE: AggregateLlmUsage = {
  tokens: {
    input: 0,
    output: 0,
    cachedInput: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
  },
  catalogCostUsd: 0,
};

/** Both calls' billed usage; research may be absent when it failed. */
function usageFrom(
  research: LlmCallMetadata | undefined,
  finalize: AggregateLlmUsage = NO_USAGE,
): QueueLivenessUsage {
  const researchTokens = research?.tokens ?? NO_USAGE.tokens;
  // An unpriced research dimension (OpenAI web searches carry no catalog
  // price) makes the total unpriced rather than silently low.
  const researchCost = research === undefined ? 0 : research.catalogCostUsd;
  // The finalize call has no tools, so its catalog cost is token-only.
  const tokenCostUsd =
    textTokenCostUsd(researchTokens) + finalize.catalogCostUsd;
  return {
    inputTokens: researchTokens.input + finalize.tokens.input,
    outputTokens: researchTokens.output + finalize.tokens.output,
    cachedInputTokens: researchTokens.cachedInput + finalize.tokens.cachedInput,
    webSearchRequests: research?.serverToolRequests?.webSearch ?? 0,
    tokenCostUsd,
    ...(researchCost === undefined
      ? {}
      : { costUsd: researchCost + finalize.catalogCostUsd }),
  };
}

function textTokenCostUsd(tokens: TokenBreakdown): number {
  const cost = costForTextUsage(QUEUE_LIVENESS_MODEL, {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cachedInput,
    cacheWriteTokens: tokens.cacheWrite,
  });
  if (cost === undefined) {
    throw new Error(`missing text pricing for ${QUEUE_LIVENESS_MODEL}`);
  }
  return cost;
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Provider, transport, timeout, and structured-output failures are external
 * boundary errors: the check degrades to `unknown` and the warning stays
 * active. Anything else (a missing credential, a programming error) is a
 * broken internal contract and fails the activity.
 */
function isLlmBoundaryError(error: unknown): boolean {
  return (
    AISDKError.isInstance(error) ||
    error instanceof StructuredOutputUsageError ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

function callSignal(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer === undefined ? timeout : AbortSignal.any([outer, timeout]);
}

export async function verifyQueueLiveness(
  input: QueueLivenessInput,
  llm: QueueLivenessLlm = runtimeQueueLivenessLlm,
): Promise<QueueLivenessCheck> {
  let research: QueueLivenessResearch | undefined;
  try {
    research = await llm.research({
      system: RESEARCH_SYSTEM,
      prompt: livenessResearchPrompt(input),
      abortSignal: callSignal(input.abortSignal, RESEARCH_TIMEOUT_MS),
    });
    const finalized = await llm.finalize({
      system: FINALIZE_SYSTEM,
      prompt: finalizePrompt(input, research),
      abortSignal: callSignal(input.abortSignal, FINALIZE_TIMEOUT_MS),
    });
    const accepted = acceptLivenessVerdict(finalized.verdict, research.sources);
    const rationale = finalized.verdict.rationale.slice(0, MAX_RATIONALE_CHARS);
    return {
      findingId: input.findingId,
      queue: input.queue,
      ...accepted,
      rationale:
        accepted.unsupportedLive === true
          ? `Model reported live, but cited no Riot or wiki page returned by its web search. ${rationale}`
          : rationale,
      ...(accepted.status === "ended" && finalized.verdict.endedOn !== null
        ? { endedOn: finalized.verdict.endedOn }
        : {}),
      usage: usageFrom(research.metadata, finalized.usage),
    };
  } catch (error: unknown) {
    if (input.abortSignal?.aborted === true || !isLlmBoundaryError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `scout queue liveness check for ${input.queue} failed (${errorClass(error)}): ${message}`,
    );
    return {
      findingId: input.findingId,
      queue: input.queue,
      status: "unknown",
      rationale: `Liveness check failed: ${message}`.slice(
        0,
        MAX_RATIONALE_CHARS,
      ),
      sources: [],
      errorClass: errorClass(error),
      usage: usageFrom(
        research?.metadata,
        error instanceof StructuredOutputUsageError ? error.usage : undefined,
      ),
    };
  }
}

// Only the fields the liveness prompt reads; the Scout data package owns the
// full contract and validates the file in its own tests.
const QueueWindowsFileSchema = z.object({
  queues: z.record(
    z.string(),
    z.array(
      z.object({
        start: z.string(),
        end: z.string().nullable(),
        note: z.string().optional(),
      }),
    ),
  ),
});

/**
 * Check every `sparse-no-close` warning, sequentially with a heartbeat before
 * each one. Zero matches cannot distinguish an ended mode from one tracked
 * players skip, so these are the only warnings worth an external opinion.
 */
export async function checkSparseQueueLiveness(input: {
  report: QueueWindowsReport;
  queueWindowsFile: string;
  lookbackDays: number;
}): Promise<QueueLivenessCheck[]> {
  const sparse = input.report.warnings.filter(
    (warning) => warning.kind === "sparse-no-close",
  );
  if (sparse.length === 0) return [];
  const file = QueueWindowsFileSchema.parse(
    await Bun.file(input.queueWindowsFile).json(),
  );
  const today = new Date().toISOString().slice(0, 10);
  const checks: QueueLivenessCheck[] = [];
  for (const warning of sparse) {
    const queue = warning.queue;
    const findingId = queueWarningFinding(warning).id;
    if (queue === undefined || findingId === undefined) {
      throw new Error(
        `sparse-no-close warning has no queue name: ${warning.message}`,
      );
    }
    const window = file.queues[queue]?.at(-1);
    Context.current().heartbeat({ phase: "queue-liveness", queue });
    checks.push(
      await verifyQueueLiveness({
        findingId,
        queue,
        window:
          window?.end === null
            ? { start: window.start, note: window.note }
            : undefined,
        patchNotes: input.report.patchNotes,
        lookbackDays: input.lookbackDays,
        today,
        abortSignal: Context.current().cancellationSignal,
      }),
    );
  }
  return checks;
}

/** Warnings not cleared by a guarded `live` verdict; these drive escalation. */
export function unverifiedWarnings(
  warnings: QueueWindowsReport["warnings"],
  livenessChecks: readonly QueueLivenessCheck[],
): QueueWindowsReport["warnings"] {
  const verifiedLive = new Set(
    livenessChecks
      .filter((check) => check.status === "live")
      .map((check) => check.findingId),
  );
  return warnings.filter((warning) => {
    const id = queueWarningFinding(warning).id;
    return id === undefined || !verifiedLive.has(id);
  });
}
