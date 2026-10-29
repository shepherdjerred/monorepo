import { describe, expect, test } from "vitest";
import { getR2StorageRuleGroups } from "./r2-storage.ts";

describe("R2 storage alerts", () => {
  test("applies existing capacity and exporter alerts to every bucket label", () => {
    const storage = getR2StorageRuleGroups().find(
      (group) => group.name === "r2-storage",
    );
    if (storage?.rules === undefined) {
      throw new Error("Missing R2 storage rule group");
    }
    for (const rule of storage.rules) {
      expect(rule.expr.value).not.toContain('bucket="homelab"');
    }
  });
});

describe("Velero R2 orphan alerts", () => {
  test("emits prefix, bytes, and freshness alerts for the R2 audit", () => {
    const group = getR2StorageRuleGroups().find(
      (candidate) => candidate.name === "velero-r2-orphans",
    );
    if (group?.rules === undefined) {
      throw new Error("Missing Velero R2 orphans rule group");
    }
    expect(
      group.rules.map((rule) => [
        rule.alert,
        rule.labels?.["severity"],
        rule.for ?? "",
      ]),
    ).toEqual([
      ["VeleroZfsBackupChainIncomplete", "critical", "5m"],
      ["VeleroR2OrphanPrefixes", "warning", "15m"],
      ["VeleroR2OrphanBytesExcessive", "warning", "15m"],
      ["VeleroR2OrphanAuditNotRunning", "warning", "1h"],
    ]);
  });
});
