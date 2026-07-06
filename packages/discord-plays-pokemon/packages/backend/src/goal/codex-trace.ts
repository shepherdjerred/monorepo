// Thin shim over the shared llm-observability codex adapter. Keeps dpp's
// goal-shaped options API and the historical span/attribute names
// (`pokemon.goal.*` spans, `pokemon.tool.*` attrs) while the JSONL→span
// synthesis itself lives in the package (promoted from this file).

import { attachCodexTrace as attachSharedCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import type { CodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { logger } from "#src/logger.ts";

export type CodexTraceOptions = {
  // Stable id for this goal run, used to correlate all spans + S3 artifacts.
  goalId: string;
  goal: string;
  model: string;
  requestedBy: string;
  // Inlined into the root span attrs so the archive envelope contains the same
  // context the model saw.
  gameStateSummary: string;
  // The full rendered prompt (system instructions). Logged once on the root
  // span; per-turn input.messages will be deltas (just the new user/tool turn).
  initialPrompt: string;
};

export type CodexTrace = {
  // Closes the root span (call once when the goal exits — completed, failed,
  // timeout, replaced, shutdown). Idempotent.
  end: () => void;
};

export function attachCodexTrace(
  parser: CodexJsonlParser,
  options: CodexTraceOptions,
): CodexTrace {
  return attachSharedCodexTrace(parser, {
    service: "discord-plays-pokemon",
    callSite: "goal-run",
    model: options.model,
    spanPrefix: "pokemon.goal",
    toolAttributePrefix: "pokemon.tool",
    rootAttributes: {
      "pokemon.goal.id": options.goalId,
      "pokemon.goal.text": options.goal,
      "pokemon.goal.requested_by": options.requestedBy,
      "pokemon.goal.game_state": options.gameStateSummary,
    },
    initialPrompt: options.initialPrompt,
    logger: {
      warn: (message) => {
        logger.warn(message);
      },
      info: (message) => {
        logger.info(message);
      },
    },
  });
}
