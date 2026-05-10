import { z } from "zod";

const AlertSchema = z.object({
  labels: z.record(z.string(), z.string()).default({}),
  status: z.object({ state: z.string() }),
});

export type AlertmanagerAlert = z.infer<typeof AlertSchema>;

export class AlertmanagerClient {
  constructor(private readonly baseUrl: string) {}

  async getActiveAlerts(): Promise<AlertmanagerAlert[]> {
    const url = new URL("/api/v2/alerts", this.baseUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("silenced", "false");
    url.searchParams.set("inhibited", "false");

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      throw new Error(
        `Alertmanager request failed: ${response.status.toString()}`,
      );
    }

    return z.array(AlertSchema).parse(await response.json());
  }
}
