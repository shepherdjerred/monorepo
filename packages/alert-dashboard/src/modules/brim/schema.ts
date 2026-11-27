import { z } from "zod";

const Version = z.literal(1);
const DateText = z.iso.datetime({ offset: true });
const Status = z.enum([
  "current",
  "sign_in_required",
  "unavailable",
  "disabled",
  "not_reporting",
]);

const QuotaWindow = z.object({
  id: z.string(),
  label: z.string(),
  usedPercent: z.number().nullish(),
  resetAt: z.number().nullish(),
});

const Quota = z.object({
  provider: z.string(),
  status: Status,
  snapshot: z
    .object({
      accountLabel: z.string().nullish(),
      plan: z
        .object({ name: z.string(), monthlyCostUSD: z.number().nullish() })
        .nullish(),
      sourceTimestamp: z.number(),
      windows: z.array(QuotaWindow),
      resets: z.array(z.object({ exp: z.number() })).optional(),
      resetErrorMessage: z.string().nullish(),
      notes: z.array(z.string()).optional(),
    })
    .nullish(),
});

const Billing = z.object({
  platform: z.string(),
  status: Status,
  snapshot: z
    .object({
      workspaceNames: z.array(z.string()),
      monthlySpend: z.number(),
      projectedSpend: z.number(),
      creditsRemaining: z.number().nullish(),
      creditGrants: z
        .array(
          z.object({
            kind: z.enum(["purchased", "granted", "unspecified"]),
            remainingUSD: z.number(),
            expiresAt: z.number().nullish(),
          }),
        )
        .optional(),
      creditGrantsUnavailableReason: z.string().nullish(),
      sourceTimestamp: z.number(),
    })
    .nullish(),
});

export const BrimOverviewSchema = z.object({
  version: Version,
  collector: z.object({
    device: z.literal("macbook"),
    collectedAt: z.number().nullable(),
    expiresAt: z.number().nullable(),
  }),
  quotas: z.array(Quota),
  billing: z.array(Billing),
  quotaHistory: z.array(
    z.object({
      provider: z.string(),
      windowID: z.string(),
      label: z.string(),
      usedPercent: z.number(),
      resetAt: z.number().nullish(),
      recordedAt: z.number(),
    }),
  ),
  archive: z.object({
    lastSuccessfulSyncAt: DateText.nullable(),
    devices: z.array(
      z.object({
        machineId: z.string(),
        displayName: z.string(),
        lastArchivedAt: DateText.nullable(),
        lastIndexedAt: DateText.nullable(),
      }),
    ),
  }),
});
export type BrimOverview = z.infer<typeof BrimOverviewSchema>;
export type BrimStatus = z.infer<typeof Status>;

export const BrimPrioritiesSchema = z.object({
  version: Version,
  priorities: z.array(
    z.object({
      coreId: z.string(),
      terminalId: z.string(),
      priority: z.enum(["p0", "p1", "p2", "p3", "p4", "later"]),
      updatedAt: DateText,
      title: z.string().nullish(),
      machineName: z.string().nullish(),
    }),
  ),
});

// Hub consumes small projections of toolkit's history-api-* JSON contracts.
const HistorySession = z.object({
  id: z.number().int().positive(),
  source: z.string(),
  title: z.string(),
  sourceId: z.string(),
  machine: z.string().nullable(),
  workspace: z.string().nullable(),
  gitBranch: z.string().nullable(),
  primaryModel: z.string().nullable(),
  createdAt: DateText,
  updatedAt: DateText,
  messageCount: z.number(),
  toolCallCount: z.number(),
});

export const HistorySessionsSchema = z.object({
  apiVersion: Version,
  sessions: z.array(HistorySession),
  hasMore: z.boolean(),
});
export type HistorySession = z.infer<typeof HistorySession>;

export const HistorySessionDetailSchema = z.object({
  apiVersion: Version,
  session: HistorySession,
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "tool", "unknown"]),
      text: z.string(),
      createdAt: DateText.nullable(),
      toolName: z.string().nullable(),
    }),
  ),
  totalMessages: z.number(),
});

const Facet = z.object({ key: z.string().nullable(), sessions: z.number() });
export const HistoryFacetsSchema = z.object({
  apiVersion: Version,
  machines: z.array(Facet),
  sources: z.array(Facet),
  workspaces: z.array(Facet),
});

export const UsagePeriod = z.enum(["day", "week", "month"]);
export const UsageBreakdown = z.enum(["machine", "agent", "model", "project"]);
const UsageTotals = z.object({
  totalTokens: z.number(),
  events: z.number(),
  costUsd: z.number(),
  costComplete: z.boolean(),
});
export const UsageReportSchema = z.object({
  apiVersion: Version,
  timezone: z.string(),
  total: UsageTotals.extend({ unpricedModels: z.array(z.string()) }),
  periods: z.array(
    UsageTotals.extend({
      period: z.string(),
      start: DateText,
      breakdown: z.array(
        UsageTotals.extend({
          machine: z.string().nullable(),
          agent: z.string().nullable(),
          model: z.string().nullable(),
          project: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const HistoryBlocksSchema = z.object({
  apiVersion: Version,
  blocks: z.array(
    UsageTotals.extend({
      agent: z.string(),
      start: DateText,
      end: DateText,
      alignedToQuota: z.boolean(),
      projection: z
        .object({
          projectedTokens: z.number(),
          projectedCostUsd: z.number(),
        })
        .nullable(),
    }),
  ),
});

const HistoryCapture = z.object({
  id: z.number().int().positive(),
  cli: z.string(),
  startedAt: DateText,
  model: z.string().nullable(),
  status: z.enum(["pending", "ok", "error", "incomplete"]),
  contextComplete: z.boolean(),
  blockCount: z.number(),
  newBlockCount: z.number(),
  previousCaptureId: z.number().int().positive().nullable(),
  warmup: z.boolean(),
});
export const HistoryCapturesSchema = z.object({
  apiVersion: Version,
  captures: z.array(HistoryCapture),
  hasMore: z.boolean(),
});

export const CaptureBlock = z.object({
  hash: z.string(),
  section: z.string(),
  index: z.number(),
  role: z.string().nullable(),
  inherited: z.boolean(),
  isNew: z.boolean(),
  parts: z.array(z.unknown()),
});
export const HistoryCaptureDetailSchema = z.object({
  apiVersion: Version,
  capture: HistoryCapture,
  request: z.object({
    system: z.array(CaptureBlock),
    tools: z.array(CaptureBlock),
    messages: z.array(CaptureBlock),
  }),
  response: z
    .object({
      text: z.string(),
      reasoning: z.string(),
      toolCalls: z.array(z.unknown()),
      stopReason: z.string().nullable(),
    })
    .nullable(),
  newBlocks: z.array(CaptureBlock),
  rawRequest: z.unknown(),
  rawResponse: z.unknown(),
  fields: z.array(z.unknown()).nullable(),
});
export type CaptureBlock = z.infer<typeof CaptureBlock>;
