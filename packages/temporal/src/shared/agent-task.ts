import { z } from "zod/v4";
import {
  AgentTaskEvidenceCollectorsV2Schema,
  AgentTaskEvidenceCriteriaV2Schema,
} from "./agent-task-evidence-contract.ts";
import { validateCollectorRelationships } from "./agent-task-input-validation.ts";
import {
  jsonSchemaFingerprint,
  stripClaudeSchemaAnnotations,
} from "./agent-task-json-schema.ts";

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

const AgentTaskCheckDefinitionV2Base = {
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  required: z.boolean(),
  evidenceRequirement: z.string().min(1),
};

// evidenceCriteria and evidenceCollectors are optional only for replaying v2
// inputs recorded before independent collection existed. New API and
// source-defined inputs use AgentTaskInputV2Schema, which requires collectors.
export const AgentTaskCheckDefinitionV2Schema = z.object({
  ...AgentTaskCheckDefinitionV2Base,
  evidenceCriteria: AgentTaskEvidenceCriteriaV2Schema.optional(),
  evidenceCollectors: AgentTaskEvidenceCollectorsV2Schema.optional(),
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

const AgentTaskInputBaseSchema = z.object({
  contractVersion: z.literal(2).optional(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  checks: z.array(AgentTaskCheckDefinitionV2Schema).min(1).optional(),
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
});

export const AgentTaskInputSchema = AgentTaskInputBaseSchema.superRefine(
  (value, ctx) => {
    if (value.runAt !== undefined && value.cron !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "agent task must not set both runAt and cron",
        path: ["runAt"],
      });
    }
    if (value.contractVersion === 2 && value.checks === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "agent task v2 requires declared checks",
        path: ["checks"],
      });
    }
    if (value.contractVersion !== 2 && value.checks !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "declared checks require contractVersion 2",
        path: ["contractVersion"],
      });
    }
    if (value.contractVersion === 2 && value.allowSelfCancel) {
      ctx.addIssue({
        code: "custom",
        message: "agent task v2 cannot self-cancel a schedule",
        path: ["allowSelfCancel"],
      });
    }
    const checkIds = new Set(value.checks?.map((check) => check.id));
    if (checkIds.size !== (value.checks?.length ?? 0)) {
      ctx.addIssue({
        code: "custom",
        message: "agent task check ids must be unique",
        path: ["checks"],
      });
    }
    for (const [checkIndex, check] of (value.checks ?? []).entries()) {
      for (const [collectorIndex, collector] of (
        check.evidenceCollectors ?? []
      ).entries()) {
        validateCollectorRelationships(
          checkIndex,
          collectorIndex,
          collector,
          ctx,
        );
      }
    }
  },
);

export const AgentTaskInputV2Schema = AgentTaskInputSchema.superRefine(
  (value, ctx) => {
    if (value.contractVersion !== 2) {
      ctx.addIssue({
        code: "custom",
        message: "contractVersion 2 is required",
        path: ["contractVersion"],
      });
    }
    for (const [index, check] of (value.checks ?? []).entries()) {
      if (check.evidenceCriteria !== undefined) {
        ctx.addIssue({
          code: "custom",
          message:
            "evidenceCriteria is replay-only; new v2 checks require independent collectors",
          path: ["checks", index, "evidenceCriteria"],
        });
      }
      if (check.evidenceCollectors === undefined) {
        ctx.addIssue({
          code: "custom",
          message:
            "new v2 checks require independently executed evidenceCollectors",
          path: ["checks", index, "evidenceCollectors"],
        });
        continue;
      }
      for (const [
        collectorIndex,
        collector,
      ] of check.evidenceCollectors.entries()) {
        if (collector.expectation === undefined) {
          ctx.addIssue({
            code: "custom",
            message:
              "new v2 evidence collectors require a source-defined expectation",
            path: [
              "checks",
              index,
              "evidenceCollectors",
              collectorIndex,
              "expectation",
            ],
          });
        }
      }
    }
  },
);

export const AgentTaskResultPayloadSchema = z.object({
  markdown: z.string().min(1),
  followUp: AgentTaskFollowUpSchema.optional(),
  cancelCron: z.boolean().optional(),
  cancelReason: z.string().min(1).optional(),
});

export const AgentTaskCheckResultV2Schema = z.object({
  id: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  summary: z.string().min(1),
  evidenceReceiptIds: z.array(z.string().min(1)),
});

export const AgentTaskFindingV2Schema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  detail: z.string().min(1).optional(),
  evidenceReceiptIds: z.array(z.string().min(1)),
});

const AgentTaskFollowUpV2SchemaBase = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  provider: AgentTaskProviderSchema.optional(),
  runAt: z.iso.datetime({ offset: true }).optional(),
  cron: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  agentTimeoutMinutes: z.number().int().positive().max(90).optional(),
});

export const AgentTaskFollowUpV2Schema =
  AgentTaskFollowUpV2SchemaBase.superRefine((value, ctx) => {
    const scheduleFieldCount =
      Number(value.runAt !== undefined) + Number(value.cron !== undefined);
    if (scheduleFieldCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "followUp must set exactly one of runAt or cron",
        path: ["runAt"],
      });
    }
  });

export const AgentTaskResultPayloadV2Schema = z.object({
  headline: z.string().min(1),
  checks: z.array(AgentTaskCheckResultV2Schema).min(1),
  findings: z.array(AgentTaskFindingV2Schema),
  limitations: z.array(z.string().min(1)),
  actions: z.array(z.string().min(1)),
  synthesis: z.string().min(1).optional(),
  followUp: AgentTaskFollowUpV2Schema.optional(),
  retirementRecommendation: z.string().min(1).optional(),
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

const AgentTaskWireFollowUpV2Schema = z
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

export const AgentTaskWireResultPayloadV2Schema = z.object({
  headline: z.string().min(1),
  checks: z.array(AgentTaskCheckResultV2Schema).min(1),
  findings: z.array(
    z.object({
      severity: z.enum(["info", "warning", "critical"]),
      summary: z.string().min(1),
      detail: z.string().min(1).nullable(),
      evidenceReceiptIds: z.array(z.string().min(1)),
    }),
  ),
  limitations: z.array(z.string().min(1)),
  actions: z.array(z.string().min(1)),
  synthesis: z.string().min(1).nullable(),
  followUp: AgentTaskWireFollowUpV2Schema.nullable(),
  retirementRecommendation: z.string().min(1).nullable(),
});

export type AgentTaskProvider = z.infer<typeof AgentTaskProviderSchema>;
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>;
export type AgentTaskInputV2 = z.infer<typeof AgentTaskInputV2Schema>;
export type AgentTaskFollowUp = z.infer<typeof AgentTaskFollowUpSchema>;
export type AgentTaskResultPayload = z.infer<
  typeof AgentTaskResultPayloadSchema
>;
export type AgentTaskWireResultPayload = z.infer<
  typeof AgentTaskWireResultPayloadSchema
>;
export type AgentTaskFollowUpV2 = z.infer<typeof AgentTaskFollowUpV2Schema>;
export type AgentTaskResultPayloadV2 = z.infer<
  typeof AgentTaskResultPayloadV2Schema
>;
export type AgentTaskWireResultPayloadV2 = z.infer<
  typeof AgentTaskWireResultPayloadV2Schema
>;

export function isAgentTaskInputV2(input: AgentTaskInput): boolean {
  return input.contractVersion === 2;
}

export function agentTaskChecksV2(input: AgentTaskInput) {
  if (!isAgentTaskInputV2(input)) {
    throw new Error("agent task does not use contractVersion 2");
  }
  return z.array(AgentTaskCheckDefinitionV2Schema).min(1).parse(input.checks);
}

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

export const AGENT_TASK_CLAUDE_SCHEMA_VERSION = "draft-07-v1";

export type AgentTaskOutputContractFailureReason =
  "missing-structured-output" | "invalid-structured-output";

export type AgentTaskOutputContractDiagnostics = {
  schemaFingerprint: string;
  finalTextExcerpt: string | undefined;
};

export class AgentTaskOutputContractError extends Error {
  readonly reason: AgentTaskOutputContractFailureReason;
  readonly diagnostics: AgentTaskOutputContractDiagnostics;

  constructor(
    reason: AgentTaskOutputContractFailureReason,
    diagnostics: AgentTaskOutputContractDiagnostics,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentTaskOutputContractError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

// Codex structured output requires every field in `required`, with optional
// fields modeled as nullable rather than absent. `AgentTaskWireResultPayloadSchema`
// exists to produce exactly that dialect for Codex SDK runs.
export const AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX: Record<string, unknown> = z
  .record(z.string(), z.unknown())
  .parse(z.toJSONSchema(AgentTaskWireResultPayloadSchema));

export const AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX_V2: Record<string, unknown> = z
  .record(z.string(), z.unknown())
  .parse(z.toJSONSchema(AgentTaskWireResultPayloadV2Schema));

// Claude's `--json-schema` contract is intentionally independent from Codex's
// strict wire schema. Draft-07 is the provider's documented compatibility
// target. `$schema` and `format` are removed because the CLI consumes the
// payload shape, not dialect metadata or nonessential annotations; the final
// semantic check remains AgentTaskResultPayloadSchema below.
const agentTaskClaudeJsonSchema = stripClaudeSchemaAnnotations(
  z.toJSONSchema(AgentTaskResultPayloadSchema, { target: "draft-7" }),
);
export const AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE: Record<string, unknown> = z
  .record(z.string(), z.unknown())
  .parse(agentTaskClaudeJsonSchema);

// buildAgentTaskSdkConfig fingerprints whichever schema a run actually sends,
// so the value logged with a contract failure always matches the live request.
export const AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT = jsonSchemaFingerprint(
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
);
