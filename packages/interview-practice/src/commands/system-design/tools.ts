import { z } from "zod/v4";
import { SystemDesignPhaseSchema } from "#lib/questions/schemas.ts";
import type { SystemDesignPhase, SystemDesignQuestion } from "#lib/questions/schemas.ts";
import type { Session } from "#lib/session/manager.ts";
import type { Logger } from "#logger";
import type { AIClient } from "#lib/ai/client.ts";
import { insertEvent } from "#lib/db/events.ts";
import { buildSystemDesignReflectionPrompt } from "#lib/ai/prompts/system-design-reflection.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";

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
  getDiagramSnapshot?: (() => string | null) | undefined;
  reflectionClient?: AIClient | undefined;
  question?: SystemDesignQuestion | undefined;
  recentTranscript?: TranscriptEntry[] | undefined;
}

export async function dispatchSystemDesignTool(
  opts: DispatchSystemDesignToolOptions,
): Promise<string> {
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
      if (opts.getDiagramSnapshot === undefined) {
        return "Diagram review not available. Ask the candidate to describe their architecture verbally.";
      }
      const snapshot = opts.getDiagramSnapshot();
      if (snapshot === null) {
        return "No diagram changes detected yet. The candidate hasn't added components to their Excalidraw diagram. Ask them to describe their architecture verbally or start drawing.";
      }
      return `Current diagram state:\n${snapshot}`;
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

      if (opts.reflectionClient === undefined || opts.question === undefined) {
        return "Reflection model not configured. Use your own judgment to assess the candidate.";
      }

      try {
        const diagramSnapshot = opts.getDiagramSnapshot?.() ?? null;
        const reflectionPrompt = buildSystemDesignReflectionPrompt({
          question: opts.question,
          currentPhase,
          recentTranscript: opts.recentTranscript ?? [],
          diagramSnapshot,
        });

        const response = await opts.reflectionClient.chat({
          systemPrompt: reflectionPrompt,
          messages: [{ role: "user", content: `Analyze the current interview state. Reason: ${reason}` }],
          maxTokens: 1024,
        });

        logger.info("sd_reflection_complete", {
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
        });

        return `Deep analysis results:\n${response.text}`;
      } catch (error) {
        logger.error("sd_reflection_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return "Reflection analysis failed. Use your own judgment to assess the candidate.";
      }
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
