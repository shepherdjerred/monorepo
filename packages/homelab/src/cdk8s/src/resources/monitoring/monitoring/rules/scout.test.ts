import { describe, expect, test } from "vitest";
import { getScoutRuleGroups } from "./scout.ts";

describe("Scout Temporal alert rules", () => {
  const temporal = getScoutRuleGroups().find(
    (group) => group.name === "scout-temporal",
  );

  test("covers Worker, latency, drift, projection, provider, and effect health", () => {
    if (temporal?.rules === undefined) {
      throw new Error("Missing scout-temporal rule group");
    }
    const alerts = new Set(temporal.rules.map((rule) => rule.alert));
    expect(alerts).toEqual(
      new Set([
        "ScoutTemporalDisconnected",
        "ScoutTemporalWorkerMissing",
        "ScoutTemporalActivityFailing",
        "ScoutTemporalTaskScheduleToStartHigh",
        "ScoutTemporalDurabilityMetricsUnknown",
        "ScoutTemporalReportOutboxStale",
        "ScoutTemporalReportScheduleDrift",
        "ScoutTemporalProductProjectionStale",
        "ScoutTemporalProviderAttemptInterrupted",
        "ScoutTemporalDuplicateEffectClaim",
      ]),
    );
  });

  test("alerts when Scout Temporal metrics are absent in either stage", () => {
    if (temporal?.rules === undefined) {
      throw new Error("Missing scout-temporal rule group");
    }
    for (const alert of [
      "ScoutTemporalDisconnected",
      "ScoutTemporalWorkerMissing",
      "ScoutTemporalDurabilityMetricsUnknown",
    ]) {
      const rule = temporal.rules.find(
        (candidate) => candidate.alert === alert,
      );
      if (rule === undefined) throw new Error(`Missing ${alert}`);
      const expression = JSON.stringify(rule.expr);
      expect(expression).toContain("absent(");
      expect(expression).toContain(String.raw`environment=\"beta\"`);
      expect(expression).toContain(String.raw`environment=\"prod\"`);
    }
  });

  test("alerts on a queue class that lost its poller, not on coverage", () => {
    const rule = temporal?.rules?.find(
      (candidate) => candidate.alert === "ScoutTemporalWorkerMissing",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutTemporalWorkerMissing rule");
    }
    const expression = JSON.stringify(rule.expr);
    // The supervisor zero-fills every queue class on every role, so `max by
    // (queue_class)` reads 1 when anything polls a class and 0 when nothing
    // does — the same answer however the classes are shared across pods.
    expect(expression).toContain("max by (environment, queue_class)");
    // Pairing that with "something polled it before" is what keeps a class no
    // deployed role has ever polled from firing forever: which role owns which
    // class is mid-amendment, and the activity-worker Deployment that would
    // have carried two of them is deferred out of this wave.
    expect(expression).toContain("max_over_time(");
    // The memory window must OUTLIVE the outage it remembers. A short lookback
    // lets an outage walk its own evidence out of the window, at which point
    // the alert resolves itself while the queue is still dead — worse than
    // never firing, because a resolved alert reads as a fixed problem.
    expect(expression).toContain("[30d]");
    for (const shortWindow of ["[5m]", "[30m]", "[1h]", "[6h]", "[24h]"]) {
      expect(expression).not.toContain(shortWindow);
    }
    // A count of workers per environment is a sum over pods: it survives a
    // dead pod another replica covers for, and dips during rolling restarts.
    expect(expression).not.toContain("count by (environment)");
    expect(expression).not.toContain("< 5");
  });

  test("uses live Temporal server labels and second-valued queue latency", () => {
    if (temporal?.rules === undefined) {
      throw new Error("Missing scout-temporal rule group");
    }
    const activityFailure = temporal.rules.find(
      (rule) => rule.alert === "ScoutTemporalActivityFailing",
    );
    const scheduleToStart = temporal.rules.find(
      (rule) => rule.alert === "ScoutTemporalTaskScheduleToStartHigh",
    );
    if (activityFailure === undefined || scheduleToStart === undefined) {
      throw new Error("Missing Scout Temporal server-metric alert rules");
    }

    const activityExpression = JSON.stringify(activityFailure.expr);
    expect(activityExpression).toContain(
      "sum by (exported_namespace, taskqueue, activityType)",
    );
    expect(activityExpression).toContain(
      String.raw`exported_namespace=~\"beta|prod\"`,
    );
    expect(activityExpression).toContain(
      String.raw`taskqueue=~\"scout(_.*)?\"`,
    );
    expect(activityExpression).not.toContain("task_queue");

    const latencyExpression = JSON.stringify(scheduleToStart.expr);
    expect(latencyExpression).toContain(
      "sum by (exported_namespace, taskqueue, le)",
    );
    expect(latencyExpression).toContain(
      "task_schedule_to_start_latency_bucket",
    );
    expect(latencyExpression).toContain("> 10");
    expect(latencyExpression).not.toContain("10000");
    expect(latencyExpression).not.toContain("task_queue");
  });
});

describe("Scout Riot API alert rules", () => {
  const riotApi = getScoutRuleGroups().find(
    (group) => group.name === "scout-riot-api",
  );

  test("covers error rate and app rate limit usage", () => {
    if (riotApi?.rules === undefined) {
      throw new Error("Missing scout-riot-api rule group");
    }
    const alerts = new Set(riotApi.rules.map((rule) => rule.alert));
    expect(alerts).toEqual(
      new Set([
        "ScoutRiotApiErrorRateHigh",
        "ScoutRiotApiErrorRateCritical",
        "ScoutRiotApiAppRateLimitHigh",
        "ScoutRiotApiAppRateLimitCritical",
      ]),
    );
  });
});

describe("Scout bot-health alert rules", () => {
  const botHealth = getScoutRuleGroups().find(
    (group) => group.name === "scout-bot-health",
  );

  test("defines the scout-bot-health group", () => {
    if (botHealth === undefined) {
      throw new Error("Missing scout-bot-health rule group");
    }
    expect(botHealth.rules).toBeDefined();
  });

  test("pages when the bot is disconnected from Discord", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutDiscordDisconnected",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutDiscordDisconnected rule");
    }
    expect(rule.labels?.["severity"]).toBe("critical");
    // Expr is rendered via PrometheusRuleSpecGroupsRulesExpr.fromString.
    expect(JSON.stringify(rule.expr)).toContain("discord_connection_status");
  });

  test("scopes the Discord gauge to each stage's gateway-owning role", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutDiscordDisconnected",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutDiscordDisconnected rule");
    }
    const expression = JSON.stringify(rule.expr);
    // The selector has to describe the DEPLOYED topology, not the capability
    // table: a role that is split-capable but has no Deployment produces no
    // series, so naming it here would make the absent() guard fire
    // continuously against a healthy stage.
    //
    // Beta now names `gateway` because the scout-gateway Deployment ships in
    // this same revision — the flip and the pod land together, so neither is
    // briefly true alone. Prod stays `combined` until its own split gate.
    expect(expression).toContain(
      String.raw`environment=\"beta\",role=\"gateway\"`,
    );
    expect(expression).toContain(
      String.raw`environment=\"prod\",role=\"combined\"`,
    );
    // Prod must NOT have moved with beta: the stages split independently, and
    // naming a role prod does not run is exactly the continuous page above.
    expect(expression).not.toContain(
      String.raw`environment=\"prod\",role=\"gateway\"`,
    );
    // The deferred role still owns no pod in either stage.
    expect(expression).not.toContain("activity-worker");
    // Every read of the gauge must be scoped, not just the first.
    const gaugeReads = expression.split("discord_connection_status").length - 1;
    const scopedReads = expression.split(String.raw`role=\"`).length - 1;
    expect(scopedReads).toBe(gaugeReads);
    // Scoping to one role per stage means the rule goes quiet when that stage
    // has no gateway-owning pod, which is the outage it exists to catch.
    expect(expression).toContain("absent(");
  });

  test("warns 14 days before production season metadata expires", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutSeasonScheduleExpiring",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutSeasonScheduleExpiring rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(rule.labels?.["severity"]).toBe("warning");
    expect(expression).toContain("scout_season_schedule_end_timestamp_seconds");
    expect(expression).toContain(String.raw`environment=\"prod\"`);
    expect(expression).toContain("1209600");
    expect(expression).toContain("259200");
  });

  test("pages below three days and after production metadata expires", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutSeasonScheduleCritical",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutSeasonScheduleCritical rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(rule.labels?.["severity"]).toBe("critical");
    expect(expression).toContain("scout_season_schedule_end_timestamp_seconds");
    expect(expression).toContain(String.raw`environment=\"prod\"`);
    expect(expression).toContain("259200");
  });

  test("warns when a cron job stalls", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutCronJobStale",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutCronJobStale rule");
    }
    expect(rule.labels?.["severity"]).toBe("warning");
    expect(JSON.stringify(rule.expr)).toContain(
      "cron_job_last_success_timestamp",
    );
  });

  test("warns when the oldest initial history import exceeds six hours", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutInitialHistoryImportStale",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutInitialHistoryImportStale rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(rule.labels?.["severity"]).toBe("warning");
    expect(expression).toContain(
      "scout_initial_history_import_oldest_actionable_timestamp_seconds",
    );
    expect(expression).toContain("21600");
  });

  test("warns on a delivery-blocked spike", () => {
    const rule = botHealth?.rules?.find(
      (candidate) => candidate.alert === "ScoutGuildDeliveryBlockedSpike",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutGuildDeliveryBlockedSpike rule");
    }
    expect(JSON.stringify(rule.expr)).toContain("guild_send_blocked_total");
  });
});

describe("Scout web alert rules", () => {
  const web = getScoutRuleGroups().find((group) => group.name === "scout-web");

  test("defines the scout-web group", () => {
    if (web === undefined) {
      throw new Error("Missing scout-web rule group");
    }
    expect(web.rules).toBeDefined();
  });

  test("pages on sustained backend 5xx responses", () => {
    const rule = web?.rules?.find(
      (candidate) => candidate.alert === "ScoutWeb5xxRateHigh",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutWeb5xxRateHigh rule");
    }
    expect(rule.labels?.["severity"]).toBe("critical");
    expect(JSON.stringify(rule.expr)).toContain("scout_http_requests_total");
    expect(JSON.stringify(rule.expr)).toContain("5xx");
  });

  test("warns when Discord is unreachable, excluding expired user grants", () => {
    const rule = web?.rules?.find(
      (candidate) => candidate.alert === "ScoutDiscordUpstreamFailures",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutDiscordUpstreamFailures rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(expression).toContain("scout_discord_user_guilds_failures_total");
    // A user whose Discord grant lapsed is not an outage — they just sign in
    // again — so it must not contribute to this alert.
    expect(expression).toContain("token_refresh_failed");
    expect(expression).toContain("reason!=");
  });

  test("tRPC error alert ignores ordinary anonymous and permission traffic", () => {
    const rule = web?.rules?.find(
      (candidate) => candidate.alert === "ScoutTrpcErrorRateHigh",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutTrpcErrorRateHigh rule");
    }
    const expression = JSON.stringify(rule.expr);
    // Anonymous page loads (UNAUTHORIZED) and permission denials (FORBIDDEN)
    // are normal on a public web surface; alerting on them would never stop.
    expect(expression).toContain("UNAUTHORIZED");
    expect(expression).toContain("FORBIDDEN");
    expect(expression).toContain("code!~");
  });

  test("sign-in failure alert is guarded by a minimum attempt rate", () => {
    const rule = web?.rules?.find(
      (candidate) => candidate.alert === "ScoutWebSigninFailureRate",
    );
    if (rule === undefined) {
      throw new Error("Missing ScoutWebSigninFailureRate rule");
    }
    const expression = JSON.stringify(rule.expr);
    expect(expression).toContain("scout_web_signin_total");
    // Without the attempt-rate guard, one failed sign-in on a quiet night
    // would be a 100% failure ratio and would page.
    expect(expression).toContain(" and ");
    expect(expression).toContain(String.raw`result=\"started\"`);
  });
});

describe("Scout web alert thresholds suit production volume", () => {
  const web = getScoutRuleGroups().find((group) => group.name === "scout-web");

  // Production sees ~21 sign-ins and ~90 anonymous app loads per MONTH. A
  // per-second rate threshold (`rate(...) > 0.05` needs ~45 events in-window)
  // is unreachable at that volume, so the alert would stay green through the
  // very outage it exists to detect. These rules must use absolute counts.
  test.each([
    "ScoutWeb5xxRateHigh",
    "ScoutDiscordUpstreamFailures",
    "ScoutTrpcErrorRateHigh",
    "ScoutWebSigninFailureRate",
  ])("%s counts events rather than a per-second rate", (alertName) => {
    const rule = web?.rules?.find((candidate) => candidate.alert === alertName);
    if (rule === undefined) {
      throw new Error(`Missing ${alertName} rule`);
    }
    const expression = JSON.stringify(rule.expr);
    expect(expression).toContain("increase(");
    expect(expression).not.toContain("rate(scout_");
  });

  test("the sign-in ratio needs a countable number of attempts", () => {
    const rule = web?.rules?.find(
      (candidate) => candidate.alert === "ScoutWebSigninFailureRate",
    );
    const expression = JSON.stringify(rule?.expr);
    // A fractional per-second floor could never be met at this volume.
    expect(expression).toContain(">= 3");
  });
});

describe("Scout web alert holds are shorter than their lookback", () => {
  const web = getScoutRuleGroups().find((group) => group.name === "scout-web");

  // A `for` equal to the lookback can never fire on a burst: the oldest events
  // age out of the window before the pending alert satisfies its hold. The hold
  // must be a fraction of the observation window.
  const holdSeconds: Record<string, number> = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "6h": 21_600,
  };

  test.each([
    "ScoutWeb5xxRateHigh",
    "ScoutDiscordUpstreamFailures",
    "ScoutTrpcErrorRateHigh",
    "ScoutWebSigninFailureRate",
  ])("%s holds for less than its lookback window", (alertName) => {
    const rule = web?.rules?.find((candidate) => candidate.alert === alertName);
    if (rule === undefined) {
      throw new Error(`Missing ${alertName} rule`);
    }
    const expression = JSON.stringify(rule.expr);
    const windows = [...expression.matchAll(/\[(\d+[mh])\]/g)].map(
      (match) => holdSeconds[match[1] ?? ""] ?? 0,
    );
    const shortestWindow = Math.min(...windows);
    const hold = holdSeconds[rule.for ?? ""] ?? 0;
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThan(shortestWindow);
  });
});
