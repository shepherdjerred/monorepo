import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import {
  GroomResult,
  type GroomTask,
  ImplementResult,
} from "#shared/docs-groom-types.ts";
import {
  GROOM_PROMPT,
  buildImplementPrompt,
} from "#shared/docs-groom-prompts.ts";
import {
  docsGroomClaudeCostUsdTotal,
  docsGroomClaudeDurationSeconds,
  docsGroomClaudeTokensTotal,
  docsGroomTasksIdentifiedTotal,
} from "#observability/metrics.ts";
import {
  parseClaudeResultMessage,
  parseGroomResult,
  parseImplementResult,
  run,
} from "./docs-groom-utils.ts";
import { captureWithContext, jsonLog } from "./docs-groom-impl.ts";

const CLAUDE_ALLOWED_TOOLS = "Read,Write,Edit,Glob,Grep";
const CLAUDE_PERMISSION_MODE = "acceptEdits";

// Heartbeat the activity every 10s while claude -p is running so a hung
// subprocess fails inside the heartbeatTimeout (3× this) instead of burning
// the activity's startToCloseTimeout. Mirrors the pattern in
// `pr-agent.ts:189-247`.
const HEARTBEAT_INTERVAL_MS = 10_000;

// Pre-compute JSON Schemas at module init. Passed via `claude --json-schema`
// so the model is forced to produce schema-conformant output instead of
// best-effort JSON-in-prose.
const GROOM_RESULT_SCHEMA_JSON = JSON.stringify(z.toJSONSchema(GroomResult));
const IMPLEMENT_RESULT_SCHEMA_JSON = JSON.stringify(
  z.toJSONSchema(ImplementResult),
);

async function invokeClaude(input: {
  worktreePath: string;
  prompt: string;
  phase: "audit" | "implement";
  jsonSchema: string;
}): Promise<{ resultText: string }> {
  const { worktreePath, prompt, phase, jsonSchema } = input;

  const startMs = Date.now();
  jsonLog("info", "Invoking claude -p", phase, { worktreePath });

  const heartbeat = setInterval(() => {
    Context.current().heartbeat({ phase, elapsedMs: Date.now() - startMs });
  }, HEARTBEAT_INTERVAL_MS);

  let result;
  try {
    result = await run(
      [
        "claude",
        "-p",
        prompt,
        "--output-format",
        "json",
        "--json-schema",
        jsonSchema,
        "--allowed-tools",
        CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        CLAUDE_PERMISSION_MODE,
      ],
      { cwd: worktreePath },
    );
  } finally {
    clearInterval(heartbeat);
  }

  docsGroomClaudeDurationSeconds.observe(
    { phase },
    (Date.now() - startMs) / 1000,
  );

  let resultMsg;
  try {
    resultMsg = parseClaudeResultMessage(result.stdout);
  } catch (error: unknown) {
    captureWithContext(error, phase, {
      stdoutHead: result.stdout.slice(0, 500),
    });
    throw new Error(
      `Failed to parse claude --output-format json result: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultMsg.is_error === true) {
    const e = new Error(
      `claude -p reported is_error=true: ${resultMsg.result ?? "(no result text)"}`,
    );
    captureWithContext(e, phase);
    throw e;
  }

  // Cost / usage metrics — best effort, missing fields are OK.
  if (resultMsg.total_cost_usd !== undefined) {
    docsGroomClaudeCostUsdTotal.inc({ phase }, resultMsg.total_cost_usd);
  }
  const u = resultMsg.usage;
  if (u !== undefined) {
    if (u.input_tokens !== undefined) {
      docsGroomClaudeTokensTotal.inc({ phase, kind: "input" }, u.input_tokens);
    }
    if (u.output_tokens !== undefined) {
      docsGroomClaudeTokensTotal.inc(
        { phase, kind: "output" },
        u.output_tokens,
      );
    }
    if (u.cache_creation_input_tokens !== undefined) {
      docsGroomClaudeTokensTotal.inc(
        { phase, kind: "cache_create" },
        u.cache_creation_input_tokens,
      );
    }
    if (u.cache_read_input_tokens !== undefined) {
      docsGroomClaudeTokensTotal.inc(
        { phase, kind: "cache_read" },
        u.cache_read_input_tokens,
      );
    }
  }

  jsonLog("info", "claude -p completed", phase, {
    durationMs: Date.now() - startMs,
    costUsd: resultMsg.total_cost_usd,
    numTurns: resultMsg.num_turns,
  });

  return { resultText: resultMsg.result ?? "" };
}

export async function doInvokeClaudeGroom(
  worktreePath: string,
): Promise<GroomResult> {
  const { resultText } = await invokeClaude({
    worktreePath,
    prompt: GROOM_PROMPT,
    phase: "audit",
    jsonSchema: GROOM_RESULT_SCHEMA_JSON,
  });
  try {
    const groomResult = parseGroomResult(resultText);
    jsonLog("info", "Audit complete", "audit", {
      groomedFileCount: groomResult.groomedFiles.length,
      taskCount: groomResult.tasks.length,
    });
    for (const task of groomResult.tasks) {
      docsGroomTasksIdentifiedTotal.inc({
        difficulty: task.difficulty,
        category: task.category,
      });
    }
    return groomResult;
  } catch (error: unknown) {
    // Log full claude output to stdout (not just first 500 chars to Sentry)
    // so failed runs are debuggable from Loki without round-tripping
    // through Bugsink. Truncate at 8KB to keep individual log lines sane.
    jsonLog("error", "GroomResult parse failed — claude raw output:", "audit", {
      parseError: error instanceof Error ? error.message : String(error),
      resultTextLength: resultText.length,
      resultText: resultText.slice(0, 8000),
    });
    captureWithContext(error, "audit", {
      resultTextHead: resultText.slice(0, 500),
    });
    throw new Error(
      `Failed to parse GroomResult from claude output: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function doInvokeClaudeImplement(
  worktreePath: string,
  task: GroomTask,
): Promise<ImplementResult> {
  const prompt = buildImplementPrompt({
    ...task,
    branch: `docs-groom/${task.slug}`,
  });
  const { resultText } = await invokeClaude({
    worktreePath,
    prompt,
    phase: "implement",
    jsonSchema: IMPLEMENT_RESULT_SCHEMA_JSON,
  });
  try {
    const implResult = parseImplementResult(resultText);
    jsonLog("info", "Implementation complete", "implement", {
      taskSlug: task.slug,
      filesChangedCount: implResult.filesChanged.length,
    });
    return implResult;
  } catch (error: unknown) {
    captureWithContext(error, "implement", {
      taskSlug: task.slug,
      resultTextHead: resultText.slice(0, 500),
    });
    throw new Error(
      `Failed to parse ImplementResult from claude output: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
