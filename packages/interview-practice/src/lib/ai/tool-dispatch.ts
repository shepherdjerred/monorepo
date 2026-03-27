import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Session } from "#lib/session/manager.ts";
import type { Logger } from "#logger";
import type { TranscriptEntry } from "#lib/db/transcript.ts";
import type { ReflectionLoopOptions } from "./reflection.ts";
import { insertEvent } from "#lib/db/events.ts";
import { updateProblemForNewPart } from "#lib/session/workspace.ts";
import { runTests } from "#lib/testing/runner.ts";
import { pauseAndThink } from "./reflection.ts";

export type DispatchToolOptions = {
  toolName: string;
  input: Record<string, unknown>;
  question: LeetcodeQuestion;
  session: Session;
  solutionPath: string;
  logger: Logger;
  timer?: Timer | undefined;
  reflectionOptions?: ReflectionLoopOptions | undefined;
  recentTranscript?: TranscriptEntry[] | undefined;
  codeSnapshot?: string | null | undefined;
};

export async function dispatchTool(opts: DispatchToolOptions): Promise<string> {
  const { toolName, input, question, session, solutionPath, logger } = opts;

  const currentPart = question.parts.find(
    (p) => p.partNumber === session.metadata.currentPart,
  );

  switch (toolName) {
    case "run_tests": {
      if (!currentPart) return "No current part found.";
      session.metadata.testsRun++;
      const result = await runTests(solutionPath, currentPart.testCases);

      insertEvent(session.db, "test_run", {
        passed: result.passed,
        failed: result.failed,
        total: result.total,
        compileError: result.compileError,
      });

      if (result.compileError !== null) {
        return `Compilation failed:\n${result.compileError}`;
      }

      const details = result.results
        .map((r, i) => {
          if (r.timedOut) return `Test ${String(i + 1)}: TIMEOUT`;
          if (r.passed) return `Test ${String(i + 1)}: PASSED`;
          return `Test ${String(i + 1)}: FAILED (expected "${r.expected}", got "${r.actual}")${r.stderr ? `\nStderr: ${r.stderr}` : ""}`;
        })
        .join("\n");

      return `Test results: ${String(result.passed)}/${String(result.total)} passed\n\n${details}`;
    }

    case "reveal_next_part": {
      const result = await handleRevealNextPart(input, question, session, logger);
      return result ?? "No more parts — this is the final part of the problem.";
    }

    case "give_hint": {
      if (!currentPart) return "No current part found.";
      const level =
        typeof input["level"] === "string" ? input["level"] : "subtle";
      const availableHints = currentPart.hints.filter(
        (h) => h.level === level,
      );
      const hintIndex = Math.min(
        session.metadata.hintsGiven,
        availableHints.length - 1,
      );
      const hint = availableHints[Math.max(hintIndex, 0)];

      session.metadata.hintsGiven++;

      insertEvent(session.db, "hint_given", {
        level,
        hintIndex: session.metadata.hintsGiven,
        partNumber: session.metadata.currentPart,
      });

      if (!hint) {
        return `No ${level} hint available. Use your judgment to guide the candidate.`;
      }

      return `Hint (${level}): ${hint.content}\n\nFrame this naturally in conversation — do not read it verbatim.`;
    }

    case "pause_and_think": {
      if (opts.reflectionOptions === undefined) {
        return "Reflection model not configured. Proceeding without deep analysis.";
      }

      if (!currentPart) return "No current part found.";
      if (opts.timer === undefined) {
        return "Timer not available for reflection.";
      }

      const reflections = await pauseAndThink(opts.reflectionOptions, {
        currentPart,
        totalParts: question.parts.length,
        timer: opts.timer,
        hintsGiven: session.metadata.hintsGiven,
        testsRun: session.metadata.testsRun,
        recentTranscript: opts.recentTranscript ?? [],
        codeSnapshot: opts.codeSnapshot ?? null,
      });

      if (reflections.length === 0) {
        return "Deep analysis complete. No new insights at this time. Continue with your current approach.";
      }

      const insights = reflections
        .map((r) => `[${r.type}] ${r.content}`)
        .join("\n");

      return `Deep analysis results:\n${insights}`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

export async function handleRevealNextPart(
  input: Record<string, unknown>,
  question: LeetcodeQuestion,
  session: Session,
  logger: Logger,
): Promise<string | null> {
  const nextPartNum = session.metadata.currentPart + 1;
  const nextPart = question.parts.find((p) => p.partNumber === nextPartNum);
  if (!nextPart) return null;

  session.metadata.currentPart = nextPartNum;
  await updateProblemForNewPart(session.workspacePath, question, nextPartNum);

  insertEvent(session.db, "part_revealed", {
    partNumber: nextPartNum,
    totalParts: question.parts.length,
    reason: input["reason"],
  });

  logger.info("part_revealed", { partNumber: nextPartNum });

  return `Advanced to part ${String(nextPartNum)}/${String(question.parts.length)}. The candidate's problem.md has been updated. Present the new part: "${nextPart.prompt}"`;
}
