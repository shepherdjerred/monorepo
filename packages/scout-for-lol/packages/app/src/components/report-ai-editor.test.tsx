import { describe, expect, test } from "vitest";
import type { ReportAiQuotaSnapshot } from "@scout-for-lol/data";
import { selectBindingQuota } from "#src/components/report-ai-editor.tsx";

function quota(
  overrides: Partial<ReportAiQuotaSnapshot> = {},
): ReportAiQuotaSnapshot {
  return {
    scope: "user_guild",
    window: "minute",
    used: 3,
    limit: 3,
    remaining: 0,
    resetsAt: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("selectBindingQuota", () => {
  test("uses the latest reset when multiple quotas are exhausted", () => {
    const minute = quota({
      resetsAt: "2026-09-05T10:00:00.000Z",
    });
    const hour = quota({
      window: "hour",
      resetsAt: "2026-09-05T11:00:00.000Z",
    });

    expect(selectBindingQuota([minute, hour])).toEqual(hour);
    expect(selectBindingQuota([hour, minute])).toEqual(hour);
  });
});
