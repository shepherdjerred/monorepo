import { z } from "zod";

import type { AlertmanagerPort } from "#application/ports";
import { AlertmanagerSnapshotAlertSchema } from "#shared/schema";

const AlertmanagerResponseSchema = z.array(AlertmanagerSnapshotAlertSchema);
const LEDGER_RECEIVER_PATTERN =
  "^(alerts|alerts-ledger-only|postal-fallback|mail-fallback)$";

export class AlertmanagerClient implements AlertmanagerPort {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = z.url().parse(baseUrl).replace(/\/$/u, "");
  }

  async activeAlerts(): Promise<
    readonly z.infer<typeof AlertmanagerSnapshotAlertSchema>[]
  > {
    const url = new URL(`${this.#baseUrl}/api/v2/alerts`);
    url.searchParams.set("receiver", LEDGER_RECEIVER_PATTERN);
    const response = await fetch(url, {
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
