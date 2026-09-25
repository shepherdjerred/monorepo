import { z } from "zod";
import { fetchJson, type Fetch } from "@shepherdjerred/ops-clients/http.ts";

const AlertSchema = z.object({
  fingerprint: z.string(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()).default({}),
  startsAt: z.string(),
  generatorURL: z.string().optional(),
  status: z.object({
    state: z.enum(["active", "suppressed", "unprocessed"]),
    silencedBy: z.array(z.string()).default([]),
    inhibitedBy: z.array(z.string()).default([]),
  }),
});

const SilenceSchema = z.object({
  id: z.string(),
  status: z.object({ state: z.enum(["active", "pending", "expired"]) }),
  matchers: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      isRegex: z.boolean(),
      isEqual: z.boolean().default(true),
    }),
  ),
  startsAt: z.string(),
  endsAt: z.string(),
  createdBy: z.string(),
  comment: z.string(),
});

export type AlertmanagerAlert = z.infer<typeof AlertSchema>;
export type AlertmanagerSilence = z.infer<typeof SilenceSchema>;

/** Read-only Alertmanager v2 client. */
export class AlertmanagerClient {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; fetch?: Fetch }) {
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Active alerts that are neither silenced nor inhibited. */
  async firingAlerts(): Promise<AlertmanagerAlert[]> {
    const url = new URL("/api/v2/alerts", this.#baseUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("silenced", "false");
    url.searchParams.set("inhibited", "false");
    url.searchParams.set("unprocessed", "false");
    return await fetchJson(
      this.#fetch,
      { upstream: "alertmanager", url },
      z.array(AlertSchema),
    );
  }

  async activeSilences(): Promise<AlertmanagerSilence[]> {
    const silences = await fetchJson(
      this.#fetch,
      {
        upstream: "alertmanager",
        url: new URL("/api/v2/silences", this.#baseUrl),
      },
      z.array(SilenceSchema),
    );
    return silences.filter((silence) => silence.status.state === "active");
  }
}
