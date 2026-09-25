import { z } from "zod";

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

export type AlertSummaryItem = z.infer<typeof AlertSchema>;

export class AlertsClient {
  constructor(private readonly baseUrl: string) {}

  async listOpen(limit = 6): Promise<AlertSummaryItem[]> {
    const response = await this.fetchJson(
      `/api/v1/alerts?lifecycleState=open&limit=${limit.toString()}`,
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
