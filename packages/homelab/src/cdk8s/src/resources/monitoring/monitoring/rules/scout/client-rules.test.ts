import { describe, expect, test } from "vitest";
import { getScoutRuleGroups } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/scout.ts";
import { getScoutClientRuleGroup } from "./client-rules.ts";

const client = getScoutClientRuleGroup();

/** Every metric the rules may read; the backend defines them in metrics/scout-client.ts. */
const CLIENT_METRICS = [
  "scout_client_observations_total",
  "scout_client_identity_aliases_total",
  "scout_client_games_without_prematch",
  "scout_client_observed_games",
  "scout_client_reconciliation_oldest_age_seconds",
];

describe("Scout Client alert rules", () => {
  test("is registered in the Scout rule groups", () => {
    expect(getScoutRuleGroups().map((group) => group.name)).toContain(
      "scout-client",
    );
  });

  test("covers quarantine, alias errors, prematch coverage and reconciliation age", () => {
    expect(new Set(client.rules?.map((rule) => rule.alert))).toEqual(
      new Set([
        "ScoutClientQuarantineRateHigh",
        "ScoutClientAliasErrorRateHigh",
        "ScoutClientGamesWithoutPrematchHigh",
        "ScoutClientReconciliationBacklogStale",
        "ScoutClientCaptureSweepFailing",
      ]),
    );
  });

  test("reads only the client metrics the backend defines", () => {
    for (const rule of client.rules ?? []) {
      const referenced = [
        ...JSON.stringify(rule.expr).matchAll(/scout_client_[a-z_]+/g),
      ].map((match) => match[0]);
      expect(referenced.length).toBeGreaterThan(0);
      for (const metric of referenced) {
        expect(CLIENT_METRICS).toContain(metric);
      }
    }
  });

  test("ratio rules also require an absolute minimum of events", () => {
    for (const alert of [
      "ScoutClientQuarantineRateHigh",
      "ScoutClientAliasErrorRateHigh",
      "ScoutClientGamesWithoutPrematchHigh",
    ]) {
      const rule = client.rules?.find((candidate) => candidate.alert === alert);
      expect(JSON.stringify(rule?.expr)).toContain(" and ");
    }
  });

  test("every rule explains its threshold in its message", () => {
    for (const rule of client.rules ?? []) {
      expect(rule.annotations?.["message"]).toMatch(
        /alert above|publishing -1/,
      );
    }
  });
});
