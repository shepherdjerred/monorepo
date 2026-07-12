import type {
  DiscordAccountId,
  DiscordGuildId,
  ReportAiQuotaScope,
  ReportAiQuotaSnapshot,
  ReportAiQuotaWindow,
} from "@scout-for-lol/data";

export type ReportAiRateLimitIdentity = {
  guildId: DiscordGuildId;
  userId: DiscordAccountId;
};

export type ReportAiQuotaStatus = {
  quota: ReportAiQuotaSnapshot[];
  activeRun: boolean;
};

type ReportAiRateLimitOptions = {
  exempt?: boolean;
};

export type ReportAiRateLimitRejection = {
  allowed: false;
  quota: ReportAiQuotaSnapshot[];
  retryAfterSeconds: number;
  reason: string;
};

export type ReportAiRateLimitTicket = {
  allowed: true;
  runId: string;
  quota: ReportAiQuotaSnapshot[];
  finish: () => void;
};

type QuotaRule = {
  scope: ReportAiQuotaScope;
  window: ReportAiQuotaWindow;
  limit: number;
  durationMs: number;
};

type RuleWithKey = QuotaRule & {
  key: string;
  bucketId: string;
};

type Bucket = {
  startedAt: number;
  used: number;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MAX_ACTIVE_GLOBAL_RUNS = 5;

const QUOTA_RULES: QuotaRule[] = [
  { scope: "user_guild", window: "minute", limit: 1, durationMs: MINUTE_MS },
  { scope: "user_guild", window: "hour", limit: 3, durationMs: HOUR_MS },
  { scope: "user_guild", window: "day", limit: 8, durationMs: DAY_MS },
  { scope: "user_guild", window: "week", limit: 30, durationMs: WEEK_MS },
  { scope: "guild", window: "hour", limit: 5, durationMs: HOUR_MS },
  { scope: "guild", window: "day", limit: 20, durationMs: DAY_MS },
  { scope: "guild", window: "week", limit: 100, durationMs: WEEK_MS },
  { scope: "global", window: "hour", limit: 30, durationMs: HOUR_MS },
  { scope: "global", window: "day", limit: 150, durationMs: DAY_MS },
  { scope: "global", window: "week", limit: 500, durationMs: WEEK_MS },
];

const buckets = new Map<string, Bucket>();
const activeUserGuildRuns = new Set<string>();
let activeGlobalRuns = 0;

export function getReportAiQuotaStatus(
  identity: ReportAiRateLimitIdentity,
  now = Date.now(),
  options: ReportAiRateLimitOptions = {},
): ReportAiQuotaStatus {
  const rules = keyedRules(identity);
  return {
    quota:
      options.exempt === true
        ? []
        : rules.map((rule) => quotaSnapshot(rule, now, 0)),
    activeRun: activeUserGuildRuns.has(userGuildActiveKey(identity)),
  };
}

export function tryStartReportAiRun(
  identity: ReportAiRateLimitIdentity,
  now = Date.now(),
  options: ReportAiRateLimitOptions = {},
): ReportAiRateLimitTicket | ReportAiRateLimitRejection {
  const rules = keyedRules(identity);
  const quota =
    options.exempt === true
      ? []
      : rules.map((rule) => quotaSnapshot(rule, now, 0));
  const activeKey = userGuildActiveKey(identity);

  if (activeUserGuildRuns.has(activeKey)) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: 60,
      reason: "An AI report edit is already running for this server.",
    };
  }

  if (activeGlobalRuns >= MAX_ACTIVE_GLOBAL_RUNS) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: 60,
      reason: "AI report editing is busy. Try again shortly.",
    };
  }

  const limited = quota.find((snapshot) => snapshot.remaining === 0);
  if (limited !== undefined) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: secondsUntil(limited.resetsAt, now),
      reason: quotaReason(limited),
    };
  }

  if (options.exempt !== true) {
    for (const rule of rules) {
      const bucket = currentBucket(rule, now);
      bucket.used++;
    }
  }

  activeUserGuildRuns.add(activeKey);
  activeGlobalRuns++;
  let finished = false;

  return {
    allowed: true,
    runId: globalThis.crypto.randomUUID(),
    quota:
      options.exempt === true
        ? []
        : rules.map((rule) => quotaSnapshot(rule, now, 0)),
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      activeUserGuildRuns.delete(activeKey);
      activeGlobalRuns = Math.max(0, activeGlobalRuns - 1);
    },
  };
}

export function resetReportAiRateLimitStateForTests(): void {
  buckets.clear();
  activeUserGuildRuns.clear();
  activeGlobalRuns = 0;
}

function keyedRules(identity: ReportAiRateLimitIdentity): RuleWithKey[] {
  return QUOTA_RULES.map((rule) => {
    const key = scopeKey(identity, rule.scope);
    return {
      ...rule,
      key,
      bucketId: `${rule.scope}:${rule.window}:${key}`,
    };
  });
}

function scopeKey(
  identity: ReportAiRateLimitIdentity,
  scope: ReportAiQuotaScope,
): string {
  if (scope === "global") {
    return "global";
  }
  if (scope === "guild") {
    return identity.guildId;
  }
  return `${identity.userId}:${identity.guildId}`;
}

function userGuildActiveKey(identity: ReportAiRateLimitIdentity): string {
  return `${identity.userId}:${identity.guildId}`;
}

function quotaSnapshot(
  rule: RuleWithKey,
  now: number,
  extraUsed: number,
): ReportAiQuotaSnapshot {
  const bucket = currentBucket(rule, now);
  const used = Math.min(rule.limit, bucket.used + extraUsed);
  return {
    scope: rule.scope,
    window: rule.window,
    used,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - used),
    resetsAt: new Date(bucket.startedAt + rule.durationMs).toISOString(),
  };
}

function currentBucket(rule: RuleWithKey, now: number): Bucket {
  const existing = buckets.get(rule.bucketId);
  if (existing !== undefined && now - existing.startedAt < rule.durationMs) {
    return existing;
  }
  const bucket = { startedAt: now, used: 0 };
  buckets.set(rule.bucketId, bucket);
  return bucket;
}

function secondsUntil(resetsAt: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - now) / 1000));
}

function quotaReason(snapshot: ReportAiQuotaSnapshot): string {
  const scope =
    snapshot.scope === "user_guild"
      ? "You have"
      : snapshot.scope === "guild"
        ? "This server has"
        : "The service has";
  return `${scope} used ${snapshot.used.toString()} of ${snapshot.limit.toString()} AI report edits for this ${snapshot.window}.`;
}
