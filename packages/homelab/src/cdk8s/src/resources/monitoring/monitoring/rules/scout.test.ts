import { describe, expect, test } from "bun:test";
import { getScoutRuleGroups } from "./scout.ts";

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
