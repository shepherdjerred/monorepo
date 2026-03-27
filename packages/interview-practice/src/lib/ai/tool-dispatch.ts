import { z } from "zod/v4";
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

const CodeEditSchema = z.object({
  search: z.string(),
  replace: z.string(),
});

const HelpDebugInputSchema = z.object({
  level: z.enum(["subtle", "moderate", "explicit"]).default("subtle"),
  method: z.enum(["verbal", "code_edit"]).default("verbal"),
  description: z.string().default(""),
  codeEdit: CodeEditSchema.optional(),
});

type ApplySearchReplaceOptions = {
  solutionPath: string;
  search: string;
  replace: string;
  session: Session;
  mode: string;
  reason: string;
  level?: string | undefined;
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
      const result = await runTests(solutionPath, currentPart.testCases, question.functionSignature);

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

    case "view_code":
      return handleViewCode(solutionPath);

    case "edit_code":
      return handleEditCode(input, session, solutionPath);

    case "help_debug":
      return handleHelpDebug(input, session, solutionPath);

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

async function handleViewCode(solutionPath: string): Promise<string> {
  try {
    const code = await Bun.file(solutionPath).text();
    return code.trim() === "" ? "Solution file is empty." : code;
  } catch {
    return "Solution file does not exist yet.";
  }
}

async function handleEditCode(
  input: Record<string, unknown>,
  session: Session,
  solutionPath: string,
): Promise<string> {
  const reason = typeof input["reason"] === "string" ? input["reason"] : "unspecified";
  const fullContent = typeof input["fullContent"] === "string" ? input["fullContent"] : undefined;
  const search = typeof input["search"] === "string" ? input["search"] : undefined;
  const replace = typeof input["replace"] === "string" ? input["replace"] : undefined;

  if (fullContent !== undefined) {
    await Bun.write(solutionPath, fullContent);
    session.metadata.editsGiven++;
    insertEvent(session.db, "code_edit", { mode: "full_replace", reason });
    return "File replaced with new content.";
  }

  if (search !== undefined && replace !== undefined) {
    return applySearchReplace({ solutionPath, search, replace, session, mode: "search_replace", reason });
  }

  return "edit_code requires either 'fullContent' or both 'search' and 'replace'.";
}

async function handleHelpDebug(
  input: Record<string, unknown>,
  session: Session,
  solutionPath: string,
): Promise<string> {
  const parsed = HelpDebugInputSchema.safeParse(input);
  const { level, method, description, codeEdit } = parsed.success
    ? parsed.data
    : { level: "subtle" as const, method: "verbal" as const, description: "", codeEdit: undefined };

  session.metadata.debugHelpsGiven++;
  insertEvent(session.db, "debug_help", { level, method, description });

  if (method !== "code_edit") {
    return `Debug help (${level}): ${description}`;
  }

  if (codeEdit === undefined) {
    return `Debug help (${level}): ${description}\n\nNote: code_edit method requires a codeEdit object with search and replace fields.`;
  }

  const editResult = await applySearchReplace({
    solutionPath,
    search: codeEdit.search,
    replace: codeEdit.replace,
    session,
    mode: "debug_fix",
    reason: description,
    level,
  });

  if (editResult === "Edit applied successfully.") {
    return `Debug help (${level}): ${description}\n\nCode edit applied successfully.`;
  }

  if (editResult.includes("Search text not found")) {
    return `Debug help (${level}): ${description}\n\nNote: Could not apply code edit — search text not found.`;
  }

  return `Debug help (${level}): ${description}\n\nNote: Could not read solution file for editing.`;
}

async function applySearchReplace(opts: ApplySearchReplaceOptions): Promise<string> {
  try {
    const currentCode = await Bun.file(opts.solutionPath).text();
    if (!currentCode.includes(opts.search)) {
      return "Search text not found in the solution file. No changes made.";
    }
    const updatedCode = currentCode.replace(opts.search, opts.replace);
    await Bun.write(opts.solutionPath, updatedCode);
    opts.session.metadata.editsGiven++;
    const eventData: Record<string, unknown> = { mode: opts.mode, reason: opts.reason };
    if (opts.level !== undefined) {
      eventData["level"] = opts.level;
    }
    insertEvent(opts.session.db, "code_edit", eventData);
    return "Edit applied successfully.";
  } catch {
    return "Could not read solution file for editing.";
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
