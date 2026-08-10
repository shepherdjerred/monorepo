import { z } from "zod";

const SummarySchema = z.object({
  open: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

const AlertSchema = z.object({
  alertname: z.string(),
  severity: z.string(),
  summary: z.string(),
  lifecycleState: z.string(),
});

const AlertListSchema = z.object({
  items: z.array(AlertSchema),
  nextCursor: z.string().nullable(),
});

export type AlertsSummary = z.infer<typeof SummarySchema>;
export type AlertSummaryItem = z.infer<typeof AlertSchema>;

export class AlertsClient {
  constructor(private readonly baseUrl: string) {}

  async getSummary(): Promise<AlertsSummary> {
    const response = await this.fetchJson("/api/v1/summary");
    return SummarySchema.parse(response);
  }

  async listOpen(): Promise<AlertSummaryItem[]> {
    const response = await this.fetchJson(
      "/api/v1/alerts?lifecycleState=open&limit=6",
    );
    return AlertListSchema.parse(response).items;
  }

  private async fetchJson(path: string): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`Alerts request failed: ${response.status.toString()}`);
    }
    return response.json();
  }
}
