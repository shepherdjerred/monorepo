import { z } from "zod";
import { grafanaRequest } from "./client.ts";
import { AlertRuleSchema } from "./schemas.ts";
import type { AlertRule } from "./types.ts";

export async function listAlertRules(): Promise<AlertRule[]> {
  const result = await grafanaRequest(
    "/api/v1/provisioning/alert-rules",
    z.array(AlertRuleSchema),
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch alert rules");
  }

  return result.data;
}

export async function getAlertRule(uid: string): Promise<AlertRule> {
  const result = await grafanaRequest(
    `/api/v1/provisioning/alert-rules/${uid}`,
    AlertRuleSchema,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch alert rule");
  }

  return result.data;
}
