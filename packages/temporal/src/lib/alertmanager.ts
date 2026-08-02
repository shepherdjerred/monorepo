/** One entry of Alertmanager's `POST /api/v2/alerts` array. */
export type AlertmanagerAlert = {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string;
  generatorURL?: string;
};

/** Injectable seam: sends the alert array to Alertmanager (or a test double). */
export type AlertPoster = (alerts: AlertmanagerAlert[]) => Promise<void>;

/**
 * The real poster. POSTs to Alertmanager's write API. In-cluster the base URL
 * is `http://prometheus-kube-prometheus-alertmanager.prometheus:9093`.
 */
export function createAlertmanagerPoster(baseUrl: string): AlertPoster {
  return async (alerts: AlertmanagerAlert[]): Promise<void> => {
    const url = new URL("/api/v2/alerts", baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alerts),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Alertmanager POST ${url.toString()} failed: ${String(res.status)} ${body}`,
      );
    }
  };
}
