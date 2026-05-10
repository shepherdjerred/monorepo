import { z } from "zod";

const IncidentSchema = z.object({
  status: z.string(),
});

const IncidentsResponseSchema = z.object({
  incidents: z.array(IncidentSchema),
});

const OnCallSchema = z.object({
  user: z.object({
    summary: z.string(),
  }),
});

const OnCallsResponseSchema = z.object({
  oncalls: z.array(OnCallSchema),
});

export type PagerDutySummary = {
  triggered: number;
  acknowledged: number;
  onCall: string[];
};

export class PagerDutyClient {
  constructor(private readonly token: string) {}

  async getSummary(): Promise<PagerDutySummary> {
    const [incidents, onCalls] = await Promise.all([
      this.fetchIncidents(),
      this.fetchOnCalls(),
    ]);
    return {
      triggered: incidents.filter((incident) => incident.status === "triggered")
        .length,
      acknowledged: incidents.filter(
        (incident) => incident.status === "acknowledged",
      ).length,
      onCall: [...new Set(onCalls.map((onCall) => onCall.user.summary))],
    };
  }

  private async fetchIncidents(): Promise<z.infer<typeof IncidentSchema>[]> {
    const url = new URL("https://api.pagerduty.com/incidents");
    url.searchParams.set("statuses[]", "triggered");
    url.searchParams.set("statuses[]", "acknowledged");
    const response = await this.fetchJson(url);
    return IncidentsResponseSchema.parse(response).incidents;
  }

  private async fetchOnCalls(): Promise<z.infer<typeof OnCallSchema>[]> {
    const response = await this.fetchJson(
      new URL("https://api.pagerduty.com/oncalls"),
    );
    return OnCallsResponseSchema.parse(response).oncalls;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Token token=${this.token}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `PagerDuty request failed: ${response.status.toString()}`,
      );
    }
    return response.json();
  }
}
