import { z } from "zod/v4";
import { SystemDesignPhaseSchema } from "#lib/questions/schemas.ts";
import type { SystemDesignPhase } from "#lib/questions/schemas.ts";
import type { Session } from "#lib/session/manager.ts";
import type { Logger } from "#logger";
import { insertEvent } from "#lib/db/events.ts";

const PHASE_ORDER: SystemDesignPhase[] = [
  "requirements",
  "estimation",
  "api-design",
  "data-model",
  "high-level",
  "deep-dive",
  "trade-offs",
];

const TransitionPhaseInputSchema = z.object({
  nextPhase: SystemDesignPhaseSchema,
  reason: z.string().optional(),
});

const HintInputSchema = z.object({
  level: z.string().optional(),
});

const PauseInputSchema = z.object({
  reason: z.string().optional(),
});

export function parsePhase(value: string): SystemDesignPhase | null {
  const result = SystemDesignPhaseSchema.safeParse(value);
  if (result.success) return result.data;
  return null;
}

export type DispatchSystemDesignToolOptions = {
  toolName: string;
  input: Record<string, unknown>;
  session: Session;
  currentPhase: SystemDesignPhase;
  logger: Logger;
}

export function dispatchSystemDesignTool(
  opts: DispatchSystemDesignToolOptions,
): string {
  const { toolName, input, session, currentPhase, logger } = opts;

  switch (toolName) {
    case "transition_phase": {
      const parsed = TransitionPhaseInputSchema.safeParse(input);
      if (!parsed.success) {
        return `Invalid input. Valid phases: ${PHASE_ORDER.join(", ")}`;
      }

      const nextPhase = parsed.data.nextPhase;
      const reason = parsed.data.reason ?? "";
      const currentIdx = PHASE_ORDER.indexOf(currentPhase);
      const nextIdx = PHASE_ORDER.indexOf(nextPhase);

      if (nextIdx <= currentIdx) {
        return `Cannot transition backward. Current phase: ${currentPhase}, requested: ${nextPhase}`;
      }

      insertEvent(session.db, "phase_transition", {
        from: currentPhase,
        to: nextPhase,
        reason,
      });

      logger.info("phase_transition", {
        from: currentPhase,
        to: nextPhase,
        reason,
      });

      return `Transitioned from "${currentPhase}" to "${nextPhase}". Guide the candidate into the new phase.`;
    }

    case "review_diagram": {
      return "No diagram available yet. The candidate has not opened an Excalidraw file. Ask them to describe their architecture verbally.";
    }

    case "give_hint": {
      const parsed = HintInputSchema.safeParse(input);
      const level = parsed.success ? (parsed.data.level ?? "subtle") : "subtle";

      session.metadata.hintsGiven++;

      insertEvent(session.db, "hint_given", {
        level,
        hintIndex: session.metadata.hintsGiven,
        phase: currentPhase,
      });

      return `Hint requested (${level}). Use your judgment to guide the candidate on the current phase: ${currentPhase}. Frame the hint naturally in conversation.`;
    }

    case "pause_and_think": {
      const parsed = PauseInputSchema.safeParse(input);
      const reason = parsed.success
        ? (parsed.data.reason ?? "Thinking about the current state")
        : "Thinking about the current state";

      insertEvent(session.db, "pause_and_think", {
        reason,
        phase: currentPhase,
      });

      return `Reflection requested: ${reason}. [Reflection model not yet connected — use your own judgment for now.]`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

export function printSystemDesignHelp(): void {
  console.log(`
Commands:
  /hint  - Request a hint (affects scoring)
  /score - Show current assessment
  /time  - Show remaining time
  /quit  - End the session
  (anything else is sent to the interviewer)
`);
}
