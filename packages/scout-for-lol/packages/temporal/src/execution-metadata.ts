import {
  SearchAttributeType,
  defineSearchAttributeKey,
  type SearchAttributePair,
} from "@temporalio/common";
import { z } from "zod";

export const ExecutionEnvironmentSchema = z.enum(["dev", "beta", "prod"]);
export type ExecutionEnvironment = z.infer<typeof ExecutionEnvironmentSchema>;

export const ExecutionDomainSchema = z.enum([
  "home",
  "reports",
  "infra",
  "repo",
  "scout",
  "agent",
  "glitter",
  "maintenance",
  "platform",
]);
export type ExecutionDomain = z.infer<typeof ExecutionDomainSchema>;

export const ExecutionTriggerSchema = z.enum([
  "schedule",
  "api",
  "webhook",
  "workflow",
  "operator",
]);
export type ExecutionTrigger = z.infer<typeof ExecutionTriggerSchema>;

export const ReleaseCommitSchema = z
  .string()
  .regex(
    /^[0-9a-f]{40}$/i,
    "ReleaseCommit must be an exact 40-character Git SHA",
  );

export const ExecutionMetadataSchema = z
  .object({
    Environment: ExecutionEnvironmentSchema,
    Domain: ExecutionDomainSchema,
    Trigger: ExecutionTriggerSchema,
    ReleaseCommit: ReleaseCommitSchema,
  })
  .strict();
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;

export const TEMPORAL_UI_SUMMARY_MAX_BYTES = 200;
export const TEMPORAL_UI_DETAILS_MAX_BYTES = 20_000;

const FORBIDDEN_UI_CONTENT = [
  /!\[/u,
  /<\/?[a-z][^>]*>/iu,
  /javascript:/iu,
  /(?:password|token|secret|credential|prompt|report[ _-]?body|player[ _-]?data|puuid|summoner[ _-]?id|discord[ _-]?id)\s*[:=]/iu,
];

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeTemporalUiTextSchema(maxBytes: number, field: string) {
  return z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes("\n") || field !== "summary", {
      message: "Temporal UI summary must be a single line",
    })
    .refine((value) => utf8Length(value) <= maxBytes, {
      message: `Temporal UI ${field} exceeds ${String(maxBytes)} UTF-8 bytes`,
    })
    .refine(
      (value) => FORBIDDEN_UI_CONTENT.every((pattern) => !pattern.test(value)),
      {
        message: `Temporal UI ${field} contains prohibited or sensitive content`,
      },
    );
}

export const TemporalUiSummarySchema = safeTemporalUiTextSchema(
  TEMPORAL_UI_SUMMARY_MAX_BYTES,
  "summary",
);
export const TemporalUiDetailsSchema = safeTemporalUiTextSchema(
  TEMPORAL_UI_DETAILS_MAX_BYTES,
  "details",
);

export const TEMPORAL_SEARCH_ATTRIBUTE_KEYS = {
  Environment: defineSearchAttributeKey(
    "Environment",
    SearchAttributeType.KEYWORD,
  ),
  Domain: defineSearchAttributeKey("Domain", SearchAttributeType.KEYWORD),
  Trigger: defineSearchAttributeKey("Trigger", SearchAttributeType.KEYWORD),
  ReleaseCommit: defineSearchAttributeKey(
    "ReleaseCommit",
    SearchAttributeType.KEYWORD,
  ),
} as const;

export type TemporalExecutionUiInput = {
  readonly metadata: ExecutionMetadata;
  readonly summary: string;
  readonly description: string;
};

export type TemporalExecutionStartMetadata = {
  readonly typedSearchAttributes: SearchAttributePair[];
  readonly staticSummary: string;
  readonly staticDetails: string;
};

export function buildTemporalExecutionStartMetadata(
  input: TemporalExecutionUiInput,
): TemporalExecutionStartMetadata {
  const metadata = ExecutionMetadataSchema.parse(input.metadata);
  const staticSummary = TemporalUiSummarySchema.parse(input.summary);
  const description = TemporalUiDetailsSchema.parse(input.description);
  const staticDetails = TemporalUiDetailsSchema.parse(
    [
      description,
      "",
      `- Environment: \`${metadata.Environment}\``,
      `- Domain: \`${metadata.Domain}\``,
      `- Trigger: \`${metadata.Trigger}\``,
      `- Release commit: \`${metadata.ReleaseCommit}\``,
    ].join("\n"),
  );

  return {
    typedSearchAttributes: [
      {
        key: TEMPORAL_SEARCH_ATTRIBUTE_KEYS.Environment,
        value: metadata.Environment,
      },
      { key: TEMPORAL_SEARCH_ATTRIBUTE_KEYS.Domain, value: metadata.Domain },
      { key: TEMPORAL_SEARCH_ATTRIBUTE_KEYS.Trigger, value: metadata.Trigger },
      {
        key: TEMPORAL_SEARCH_ATTRIBUTE_KEYS.ReleaseCommit,
        value: metadata.ReleaseCommit,
      },
    ],
    staticSummary,
    staticDetails,
  };
}
