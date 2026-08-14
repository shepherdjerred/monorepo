import type {
  DiscordAccountId,
  DiscordGuildId,
  ReportAiQuotaScope,
  ReportAiQuotaSnapshot,
} from "@scout-for-lol/data";
import {
  createQuotaEngine,
  quotaSecondsUntil,
  type QuotaRule,
} from "#src/utils/quota-buckets.ts";

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

const MAX_ACTIVE_GLOBAL_RUNS = 5;

const QUOTA_RULES: QuotaRule<ReportAiQuotaScope>[] = [
  { scope: "user_guild", window: "minute", limit: 1 },
  { scope: "user_guild", window: "hour", limit: 3 },
  { scope: "user_guild", window: "day", limit: 8 },
  { scope: "user_guild", window: "week", limit: 30 },
  { scope: "guild", window: "hour", limit: 5 },
  { scope: "guild", window: "day", limit: 20 },
  { scope: "guild", window: "week", limit: 100 },
  { scope: "global", window: "hour", limit: 30 },
  { scope: "global", window: "day", limit: 150 },
  { scope: "global", window: "week", limit: 500 },
];

const engine = createQuotaEngine<ReportAiQuotaScope, ReportAiRateLimitIdentity>(
  {
    rules: QUOTA_RULES,
    scopeKey: (scope, identity) => {
      if (scope === "global") {
        return "global";
      }
      if (scope === "guild") {
        return identity.guildId;
      }
      return `${identity.userId}:${identity.guildId}`;
    },
  },
);

const activeUserGuildRuns = new Set<string>();
let activeGlobalRuns = 0;

export function getReportAiQuotaStatus(
  identity: ReportAiRateLimitIdentity,
  now = Date.now(),
  options: ReportAiRateLimitOptions = {},
): ReportAiQuotaStatus {
  return {
    quota: options.exempt === true ? [] : engine.snapshots(identity, now),
    activeRun: activeUserGuildRuns.has(userGuildActiveKey(identity)),
  };
}

export function tryStartReportAiRun(
  identity: ReportAiRateLimitIdentity,
  now = Date.now(),
  options: ReportAiRateLimitOptions = {},
): ReportAiRateLimitTicket | ReportAiRateLimitRejection {
  const quota = options.exempt === true ? [] : engine.snapshots(identity, now);
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
      retryAfterSeconds: quotaSecondsUntil(limited.resetsAt, now),
      reason: quotaReason(limited),
    };
  }

  if (options.exempt !== true) {
    engine.consume(identity, now);
  }

  activeUserGuildRuns.add(activeKey);
  activeGlobalRuns++;
  let finished = false;

  return {
    allowed: true,
    runId: globalThis.crypto.randomUUID(),
    quota: options.exempt === true ? [] : engine.snapshots(identity, now),
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
  engine.reset();
  activeUserGuildRuns.clear();
  activeGlobalRuns = 0;
}

function userGuildActiveKey(identity: ReportAiRateLimitIdentity): string {
  return `${identity.userId}:${identity.guildId}`;
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
