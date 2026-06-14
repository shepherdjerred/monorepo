import { z } from "zod/v4";

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

export type AgentTaskProvider = z.infer<typeof AgentTaskProviderSchema>;
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>;
export type AgentTaskFollowUp = z.infer<typeof AgentTaskFollowUpSchema>;
export type AgentTaskResultPayload = z.infer<
  typeof AgentTaskResultPayloadSchema
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

export const AGENT_TASK_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["markdown"],
  properties: {
    markdown: {
      type: "string",
      minLength: 1,
      description: "Markdown report to email to the user.",
    },
    followUp: {
      type: "object",
      additionalProperties: false,
      required: ["title", "prompt"],
      properties: {
        title: { type: "string", minLength: 1 },
        prompt: { type: "string", minLength: 1 },
        provider: { type: "string", enum: ["claude", "codex"] },
        runAt: {
          type: "string",
          description: "RFC3339 timestamp for a one-off follow-up.",
        },
        cron: {
          type: "string",
          description: "Cron expression for a recurring follow-up.",
        },
        model: { type: "string", minLength: 1 },
        maxTurns: { type: "integer", minimum: 1 },
        agentTimeoutMinutes: { type: "integer", minimum: 1, maximum: 90 },
      },
    },
    cancelCron: {
      type: "boolean",
      description:
        "Set true only when the owning recurring schedule should be paused.",
    },
    cancelReason: { type: "string", minLength: 1 },
  },
};

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
