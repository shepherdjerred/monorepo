import { z } from "zod";

/**
 * Live turn progress, rendered into the one Discord message the turn owns.
 *
 * Before the agentic loop a turn was a single pre-planned tool call, so there
 * was nothing to narrate: the reply either arrived or an incident reference
 * did. Now a turn investigates and can change approach, which is worth seeing -
 * and can take a while, which makes a static "…" placeholder the worst part of
 * the experience.
 *
 * Rendering is pure and the publish side is coalesced, so this module can be
 * tested without Discord and without timers.
 */

const MAX_VISIBLE_ENTRIES = 8;
const MAX_NARRATION_CHARACTERS = 280;
const MAX_LABEL_CHARACTERS = 96;
/** Discord hard-caps a message at 2000 characters. */
const MAX_PROGRESS_CHARACTERS = 1900;
const DEFAULT_MIN_PUBLISH_INTERVAL_MS = 1500;

export const ProgressEntryStatusSchema = z.enum(["running", "done", "failed"]);
export type ProgressEntryStatus = z.infer<typeof ProgressEntryStatusSchema>;

export type ProgressEntry = {
  toolCallId: string;
  label: string;
  status: ProgressEntryStatus;
  durationMs?: number;
};

export type ProgressState = {
  entries: ProgressEntry[];
  narration: string | undefined;
  stepNumber: number;
  maxSteps: number;
  elapsedMs: number;
};

function truncate(value: string, maxLength: number): string {
  const collapsed = value.replaceAll(/\s+/gu, " ").trim();
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 1)}…`;
}

/**
 * Turn a tool id and its input into something a person can read.
 *
 * Deliberately derived rather than hand-maintained per tool: a label table
 * would be one more thing to forget when a tool is added, and a stale label is
 * worse than a plain one. The model's own narration carries the nuance.
 */
export function humanizeToolLabel(toolId: string, input: unknown): string {
  const words = toolId.split("-").filter((part) => part.length > 0);
  const base =
    words.length === 0
      ? toolId
      : `${(words[0] ?? "").charAt(0).toUpperCase()}${(words[0] ?? "").slice(1)}${
          words.length > 1 ? ` ${words.slice(1).join(" ")}` : ""
        }`;
  const action = z
    .object({ action: z.string().min(1).max(40) })
    .safeParse(input);
  return truncate(
    action.success ? `${base} (${action.data.action})` : base,
    MAX_LABEL_CHARACTERS,
  );
}

function formatDuration(ms: number): string {
  return ms < 1000
    ? `${String(Math.max(0, Math.round(ms)))}ms`
    : `${(ms / 1000).toFixed(1)}s`;
}

function renderEntry(entry: ProgressEntry): string {
  const marker =
    entry.status === "done" ? "✓" : entry.status === "failed" ? "✗" : "⋯";
  const duration =
    entry.status === "running" || entry.durationMs === undefined
      ? ""
      : ` · ${formatDuration(entry.durationMs)}`;
  return `${marker} ${entry.label}${duration}`;
}

export function renderProgress(state: ProgressState): string {
  const hidden = Math.max(0, state.entries.length - MAX_VISIBLE_ENTRIES);
  const visible = state.entries.slice(-MAX_VISIBLE_ENTRIES);
  const lines = [
    "🔎 Working…",
    "",
    ...(state.narration === undefined
      ? []
      : [`> ${truncate(state.narration, MAX_NARRATION_CHARACTERS)}`, ""]),
    ...(hidden === 0
      ? []
      : [`… ${String(hidden)} earlier step${hidden === 1 ? "" : "s"}`]),
    ...visible.map((entry) => renderEntry(entry)),
    ...(visible.length === 0 ? [] : [""]),
    `step ${String(state.stepNumber)}/${String(state.maxSteps)} · ${formatDuration(state.elapsedMs)}`,
  ];
  const rendered = lines.join("\n");
  return rendered.length <= MAX_PROGRESS_CHARACTERS
    ? rendered
    : `${rendered.slice(0, MAX_PROGRESS_CHARACTERS - 1)}…`;
}

export type ProgressReporter = {
  toolStarted: (toolCallId: string, toolId: string, input: unknown) => void;
  toolFinished: (
    toolCallId: string,
    succeeded: boolean,
    durationMs: number,
  ) => void;
  /** stepNumber is the AI SDK's own 0-based step index, from onStepStart. */
  stepStarted: (stepNumber: number) => void;
  /** stepNumber must match the stepStarted call for the same step. */
  stepFinished: (stepNumber: number, stepText: string) => void;
  /** Publish anything still pending. Safe to call more than once. */
  flush: () => Promise<void>;
  snapshot: () => ProgressState;
};

export function createProgressReporter(options: {
  maxSteps: number;
  publish: (body: string) => Promise<void>;
  onPublishError: (error: unknown) => void;
  now?: () => number;
  minPublishIntervalMs?: number;
}): ProgressReporter {
  const now = options.now ?? (() => Date.now());
  const minInterval =
    options.minPublishIntervalMs ?? DEFAULT_MIN_PUBLISH_INTERVAL_MS;
  const startedAt = now();
  const entries: ProgressEntry[] = [];
  let narration: string | undefined;
  // Which displayed step (1-based) the current narration was written for, so
  // it can be hidden once a newer step starts - see stepStarted below.
  let narrationStepNumber = 0;
  let displayStepNumber = 0;
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  let inFlight: Promise<void> = Promise.resolve();

  function snapshot(): ProgressState {
    return {
      entries: [...entries],
      narration:
        narrationStepNumber === displayStepNumber ? narration : undefined,
      stepNumber: displayStepNumber,
      maxSteps: options.maxSteps,
      elapsedMs: now() - startedAt,
    };
  }

  function publishNow(): void {
    lastPublishedAt = now();
    pending = false;
    const body = renderProgress(snapshot());
    const previous = inFlight;
    // A failed progress edit must not fail the turn: this message is cosmetic
    // and the final edit is the actual contract. It is reported rather than
    // swallowed so a persistently rate-limited channel is visible in logs.
    inFlight = (async () => {
      await previous;
      try {
        await options.publish(body);
      } catch (error: unknown) {
        options.onPublishError(error);
      }
    })();
  }

  function notify(): void {
    if (now() - lastPublishedAt >= minInterval) {
      publishNow();
      return;
    }
    pending = true;
  }

  return {
    toolStarted(toolCallId, toolId, input) {
      entries.push({
        toolCallId,
        label: humanizeToolLabel(toolId, input),
        status: "running",
      });
      notify();
    },
    toolFinished(toolCallId, succeeded, durationMs) {
      const entry = entries.findLast(
        (candidate) => candidate.toolCallId === toolCallId,
      );
      if (entry !== undefined) {
        entry.status = succeeded ? "done" : "failed";
        entry.durationMs = durationMs;
      }
      notify();
    },
    stepStarted(stepNumber) {
      displayStepNumber = stepNumber + 1;
      notify();
    },
    stepFinished(stepNumber, stepText) {
      const trimmed = stepText.trim();
      if (trimmed.length > 0) {
        narration = trimmed;
        narrationStepNumber = stepNumber + 1;
      }
      notify();
    },
    async flush() {
      if (pending) {
        publishNow();
      }
      await inFlight;
    },
    snapshot,
  };
}
