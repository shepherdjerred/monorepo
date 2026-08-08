import { z } from "zod";

import type { AlertmanagerPort } from "#application/ports";
import { AlertmanagerSnapshotAlertSchema } from "#shared/schema";

const AlertmanagerResponseSchema = z.array(AlertmanagerSnapshotAlertSchema);

export class AlertmanagerClient implements AlertmanagerPort {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = z.url().parse(baseUrl).replace(/\/$/u, "");
  }

  async activeAlerts(): Promise<
    readonly z.infer<typeof AlertmanagerSnapshotAlertSchema>[]
  > {
    const response = await fetch(`${this.#baseUrl}/api/v2/alerts`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Alertmanager returned ${String(response.status)}: ${body}`,
      );
    }
    return AlertmanagerResponseSchema.parse(JSON.parse(body));
  }
}
