import { zodResponseFormat } from "openai/helpers/zod.mjs";
import { z } from "zod/v4";
import { parseClaudeResultMessage } from "./claude-result.ts";

export const AgentTaskProviderSchema = z.enum(["claude", "codex"]);
export const AgentTaskModeSchema = z.enum(["report-only"]);

export const AgentTaskRepoSchema = z.object({
  fullName: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+$/, "repo must be owner/name"),
  ref: z.string().min(1).optional(),
});

export const AgentTaskSourceSchema = z.object({
  docPath: z.string().min(1).optional(),
  url: z.url().optional(),
  note: z.string().min(1).optional(),
});

const AgentTaskFollowUpSchemaBase = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  provider: AgentTaskProviderSchema.optional(),
  runAt: z.iso.datetime({ offset: true }).optional(),
  cron: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  agentTimeoutMinutes: z.number().int().positive().max(90).optional(),
});

export const AgentTaskFollowUpSchema = AgentTaskFollowUpSchemaBase.superRefine(
  (value, ctx) => {
    if (value.runAt !== undefined && value.cron !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "followUp must not set both runAt and cron",
        path: ["runAt"],
      });
    }
    if (value.runAt === undefined && value.cron === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "followUp must set runAt or cron",
        path: ["runAt"],
      });
    }
  },
);

export const AgentTaskInputSchema = z
  .object({
    title: z.string().min(1),
    prompt: z.string().min(1),
    provider: AgentTaskProviderSchema,
    mode: AgentTaskModeSchema.default("report-only"),
    repo: AgentTaskRepoSchema,
    runAt: z.iso.datetime({ offset: true }).optional(),
    cron: z.string().min(1).optional(),
    scheduleId: z.string().min(1).optional(),
    source: AgentTaskSourceSchema.optional(),
    model: z.string().min(1).optional(),
    maxTurns: z.number().int().positive().optional(),
    agentTimeoutMinutes: z.number().int().positive().max(90).optional(),
    idempotencyKey: z.string().min(1).optional(),
    allowSelfCancel: z.boolean().default(false),
    emailSubjectPrefix: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.runAt !== undefined && value.cron !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "agent task must not set both runAt and cron",
        path: ["runAt"],
      });
    }
  });

export const AgentTaskResultPayloadSchema = z.object({
  markdown: z.string().min(1),
  followUp: AgentTaskFollowUpSchema.optional(),
  cancelCron: z.boolean().optional(),
  cancelReason: z.string().min(1).optional(),
});

const AgentTaskWireFollowUpSchema = z
  .object({
    title: z.string().min(1),
    prompt: z.string().min(1),
    provider: AgentTaskProviderSchema.nullable(),
    runAt: z.iso.datetime({ offset: true }).nullable(),
    cron: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    maxTurns: z.number().int().positive().nullable(),
    agentTimeoutMinutes: z.number().int().positive().max(90).nullable(),
  })
  .superRefine((value, ctx) => {
    const scheduleFieldCount =
      Number(value.runAt !== null) + Number(value.cron !== null);
    if (scheduleFieldCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "followUp must set exactly one of runAt or cron",
        path: ["runAt"],
      });
    }
  });

export const AgentTaskWireResultPayloadSchema = z.object({
  markdown: z.string().min(1).describe("Markdown report to email to the user."),
  followUp: AgentTaskWireFollowUpSchema.nullable(),
  cancelCron: z
    .boolean()
    .nullable()
    .describe(
      "Set true only when the owning recurring schedule should be paused.",
    ),
  cancelReason: z.string().min(1).nullable(),
});

export type AgentTaskProvider = z.infer<typeof AgentTaskProviderSchema>;
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>;
export type AgentTaskFollowUp = z.infer<typeof AgentTaskFollowUpSchema>;
export type AgentTaskResultPayload = z.infer<
  typeof AgentTaskResultPayloadSchema
>;
export type AgentTaskWireResultPayload = z.infer<
  typeof AgentTaskWireResultPayloadSchema
>;

export type AgentTaskStartResult =
  | {
      kind: "workflow";
      workflowId: string;
      runId: string;
    }
  | {
      kind: "schedule";
      scheduleId: string;
    };

// Codex's `--output-schema` is OpenAI's own CLI and requires OpenAI
// Structured-Outputs "strict mode": every field in `required`, optional
// fields modeled as nullable rather than absent. `AgentTaskWireResultPayloadSchema`
// (below) exists to produce exactly that dialect for Codex only.
export const AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX: Record<string, unknown> = z
  .record(z.string(), z.unknown())
  .parse(
    zodResponseFormat(AgentTaskWireResultPayloadSchema, "agent_task_result")
      .json_schema.schema,
  );

// Claude Code CLI's `--json-schema` does NOT accept the OpenAI-strict/nullable
// dialect above: given it, `claude -p` exits 0 but silently omits
// `structured_output` from its result message entirely, rather than erroring
// (root cause of the 2026-07-30 homelab-audit-daily outage — see
// packages/docs/todos/homelab-audit-agent-task-production-verification.md).
// Claude needs a plain JSON Schema instead: optional fields simply absent
// from `required`, no forced nullable unions. Generate it straight from the
// canonical, already-plain-optional `AgentTaskResultPayloadSchema` (not the
// wire schema), and strip the `$schema` key `z.toJSONSchema` injects by
// default so the payload matches the pre-2026-07-28 hand-written schema this
// restores. Do NOT merge this back into a single constant shared with Codex.
const { $schema: _agentTaskClaudeSchemaMeta, ...agentTaskClaudeJsonSchema } =
  z.toJSONSchema(AgentTaskResultPayloadSchema);
export const AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE: Record<string, unknown> = z
  .record(z.string(), z.unknown())
  .parse(agentTaskClaudeJsonSchema);

// Codex-only: converts the OpenAI-strict/nullable wire shape into the
// canonical plain-optional shape. Claude's output already parses directly
// against AgentTaskResultPayloadSchema (see parseAgentTaskResultPayload).
function normalizeAgentTaskFollowUp(
  followUp: AgentTaskWireResultPayload["followUp"],
): AgentTaskFollowUp | undefined {
  if (followUp === null) {
    return undefined;
  }
  return AgentTaskFollowUpSchema.parse({
    title: followUp.title,
    prompt: followUp.prompt,
    ...(followUp.provider === null ? {} : { provider: followUp.provider }),
    ...(followUp.runAt === null ? {} : { runAt: followUp.runAt }),
    ...(followUp.cron === null ? {} : { cron: followUp.cron }),
    ...(followUp.model === null ? {} : { model: followUp.model }),
    ...(followUp.maxTurns === null ? {} : { maxTurns: followUp.maxTurns }),
    ...(followUp.agentTimeoutMinutes === null
      ? {}
      : { agentTimeoutMinutes: followUp.agentTimeoutMinutes }),
  });
}

export function parseAgentTaskResultPayload(
  raw: unknown,
  provider: AgentTaskProvider,
): AgentTaskResultPayload {
  if (raw === undefined || raw === "") {
    throw new Error(
      "agent produced no structured output (expected --json-schema structured_output / --output-schema file)",
    );
  }
  try {
    const decoded: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (provider === "claude") {
      // Claude's output already matches the canonical plain-optional shape
      // (AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE) — no wire/normalize step.
      return AgentTaskResultPayloadSchema.parse(decoded);
    }
    const wire = AgentTaskWireResultPayloadSchema.parse(decoded);
    const followUp = normalizeAgentTaskFollowUp(wire.followUp);
    return AgentTaskResultPayloadSchema.parse({
      markdown: wire.markdown,
      ...(followUp === undefined ? {} : { followUp }),
      ...(wire.cancelCron === null ? {} : { cancelCron: wire.cancelCron }),
      ...(wire.cancelReason === null
        ? {}
        : { cancelReason: wire.cancelReason }),
    });
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse agent task JSON payload: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

// Parses a claude -p subprocess's raw stdout into the canonical payload,
// surfacing a distinct is_error=true diagnostic (e.g. --max-turns exhaustion)
// instead of letting it collapse into the generic "no structured output"
// message thrown by parseAgentTaskResultPayload.
export function parseClaudeAgentTaskResult(
  stdout: string,
): AgentTaskResultPayload {
  const resultMessage = parseClaudeResultMessage(stdout);
  if (resultMessage.is_error === true) {
    throw new Error(
      `claude -p reported is_error=true for agent task: ${resultMessage.result ?? "(no result text)"}`,
    );
  }
  return parseAgentTaskResultPayload(resultMessage.structured_output, "claude");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value).toSorted(([a], [b]) =>
      a.localeCompare(b),
    )) {
      sorted[key] = sortJson(entryValue);
    }
    return sorted;
  }
  return value;
}

async function shortSha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 10), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function reportOnlyPrompt(
  input: AgentTaskInput,
  workdir: string,
): string {
  const runtimeLines =
    input.agentTimeoutMinutes === undefined
      ? []
      : [
          `Runtime budget: ${String(input.agentTimeoutMinutes)} minutes.`,
          "- Keep every shell command narrowly scoped and time-bounded; use the `timeout` command when available.",
          "- If a command is slow or would exceed the budget, stop that section, mark it Skipped or Failed, and return the partial report.",
          "",
        ];
  const sourceLines =
    input.source === undefined
      ? []
      : [
          "Source context:",
          input.source.docPath === undefined
            ? undefined
            : `- docPath: ${input.source.docPath}`,
          input.source.url === undefined
            ? undefined
            : `- url: ${input.source.url}`,
          input.source.note === undefined
            ? undefined
            : `- note: ${input.source.note}`,
          "",
        ].filter((line) => line !== undefined);

  return [
    "You are running as a delayed Temporal agent task.",
    "",
    "Hard constraints:",
    "- This task is report-only.",
    "- Do not edit files, commit, push, open pull requests, open issues, or mutate live systems.",
    "- You may inspect the checked-out repository and query read-only operational tools when the prompt requires current state.",
    "- Revalidate the source context first; if the task is already resolved, report that clearly.",
    "- If a recurring schedule is no longer useful, set cancelCron=true and explain why in cancelReason.",
    "- If one future report-only follow-up is needed, set followUp with either runAt or cron.",
    "- Return only JSON matching the provided schema.",
    "",
    ...runtimeLines,
    `Task title: ${input.title}`,
    `Repository workdir: ${workdir}`,
    "",
    ...sourceLines,
    "User prompt:",
    input.prompt,
  ].join("\n");
}

export function sanitizeTemporalIdPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function agentTaskWorkflowId(
  input: AgentTaskInput,
): Promise<string> {
  const prefix = sanitizeTemporalIdPart(input.title) || "agent-task";
  const key =
    input.idempotencyKey ??
    JSON.stringify(
      sortJson({
        provider: input.provider,
        agentTimeoutMinutes: input.agentTimeoutMinutes,
        title: input.title,
        prompt: input.prompt,
        runAt: input.runAt,
        repo: input.repo,
        source: input.source,
      }),
    );
  return `agent-task-${prefix}-${await shortSha256(key)}`;
}

// Memo marker set on every schedule created via the /agent-tasks API (see
// startOrScheduleAgentTask). Orphan detection uses it to tell a dynamic,
// legitimately-undeclared agent-task schedule apart from a *declared*,
// source-controlled schedule that also runs `agentTaskWorkflow` (today that is
// homelab-audit-daily). Without this marker, keying off the workflow type alone
// would silently exempt a declared agent-task schedule that was removed from
// SCHEDULES without being added to DELETED_SCHEDULE_IDS — the exact drift the
// orphan gauge exists to catch.
export const DYNAMIC_AGENT_TASK_MEMO_KEY = "dynamicAgentTask";

export async function agentTaskScheduleId(
  input: AgentTaskInput,
): Promise<string> {
  if (input.scheduleId !== undefined) {
    return input.scheduleId;
  }
  const prefix = sanitizeTemporalIdPart(input.title) || "agent-task";
  const key =
    input.idempotencyKey ??
    JSON.stringify(
      sortJson({
        provider: input.provider,
        agentTimeoutMinutes: input.agentTimeoutMinutes,
        title: input.title,
        prompt: input.prompt,
        cron: input.cron,
        repo: input.repo,
        source: input.source,
      }),
    );
  return `agent-task-${prefix}-${await shortSha256(key)}`;
}
