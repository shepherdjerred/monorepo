import { z } from "zod";

const AnalyticsSyncResultSchema = z.strictObject({
  status: z.enum(["reconciled", "skipped"]),
  detail: z.string(),
});
export type ScoutBryanBucksAnalyticsResult = z.infer<
  typeof AnalyticsSyncResultSchema
>;
export type ScoutBryanBucksActivities = {
  syncScoutBryanBucksAnalytics: () => Promise<ScoutBryanBucksAnalyticsResult>;
};

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function syncScoutBryanBucksAnalytics(): Promise<ScoutBryanBucksAnalyticsResult> {
  const now = new Date();
  const bucket = Math.floor(now.getTime() / (15 * 60 * 1000)).toString();
  const response = await fetch(
    z.url().parse(requiredEnvironment("SCOUT_BRYAN_BUCKS_CONTROL_URL")),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredEnvironment("SCOUT_BRYAN_BUCKS_CONTROL_TOKEN")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `bryan-bucks-analytics:${bucket}`,
      },
      body: "{}",
      signal: AbortSignal.timeout(2 * 60 * 1000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Scout Bryan Bucks analytics sync returned HTTP ${response.status.toString()}: ${body.slice(0, 500)}`,
    );
  }
  return AnalyticsSyncResultSchema.parse(JSON.parse(body) as unknown);
}

export const scoutBryanBucksActivities = {
  syncScoutBryanBucksAnalytics,
};
