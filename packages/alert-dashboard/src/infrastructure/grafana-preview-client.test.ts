import { afterAll, describe, expect, it } from "vitest";

import { GrafanaPreviewClient } from "#infrastructure/grafana-preview-client";
import { AlertDetailSchema, PreviewInputSchema } from "#shared/schema";

const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    requests.push(request.url);
    return Response.json({ status: "success", data: { result: [] } });
  },
});

afterAll(async () => {
  await server.stop(true);
});

const alert = AlertDetailSchema.parse({
  id: `alert_${"a".repeat(32)}`,
  fingerprint: "safe-preview",
  alertname: "ServiceDown",
  namespace: "apps",
  severity: "warning",
  summary: "Service is down",
  lifecycleState: "open",
  suppressionState: "none",
  resolutionSource: null,
  openedAt: "2026-08-08T18:00:00Z",
  resolvedAt: null,
  lastSeenAt: "2026-08-08T18:05:00Z",
  generatorUrl:
    "https://prometheus.tailnet-1a49.ts.net/graph?g0.expr=up%7Bjob%3D%22api%22%7D",
  labels: {
    alertname: "ServiceDown",
    namespace: "apps",
    pod: "api-0",
    trace_id: "0123456789abcdef0123456789abcdef",
  },
  annotations: { summary: "Service is down" },
  events: [],
  deliveries: [],
  deliveriesNextCursor: null,
});

function client(
  allowedGeneratorHosts = ["prometheus.tailnet-1a49.ts.net"],
): GrafanaPreviewClient {
  return new GrafanaPreviewClient({
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    token: "viewer-token",
    prometheusUid: "prometheus",
    lokiUid: "loki",
    tempoUid: "tempo",
    allowedGeneratorHosts,
  });
}

describe("Grafana preview boundary", () => {
  it("derives bounded Prometheus, Loki, and Tempo requests from occurrence metadata", async () => {
    requests.length = 0;
    const input = PreviewInputSchema.parse({
      id: alert.id,
      from: "2026-08-08T18:00:00Z",
      to: "2026-08-08T19:00:00Z",
    });
    const result = await client().previews(input, alert);

    expect(result.prometheus.status).toBe("available");
    expect(result.loki.status).toBe("available");
    expect(result.tempo.status).toBe("available");
    expect(
      requests.some(
        (value) => value.includes("query_range") && value.includes("step=4"),
      ),
    ).toBe(true);
    expect(
      requests.some(
        (value) =>
          value.includes("limit=100") && value.includes("pod%3D%22api-0%22"),
      ),
    ).toBe(true);
    expect(
      requests.some((value) =>
        value.endsWith("/api/traces/0123456789abcdef0123456789abcdef"),
      ),
    ).toBe(true);
  });

  it("rejects client ranges over 24 hours and disallowed generator hosts", async () => {
    const tooLong = PreviewInputSchema.parse({
      id: alert.id,
      from: "2026-08-07T18:00:00Z",
      to: "2026-08-08T19:00:01Z",
    });
    await expect(client().previews(tooLong, alert)).rejects.toThrow(
      "Preview range exceeds 24 hours",
    );

    const input = PreviewInputSchema.parse({
      id: alert.id,
      from: "2026-08-08T18:00:00Z",
      to: "2026-08-08T19:00:00Z",
    });
    const result = await client([]).previews(input, alert);
    expect(result.prometheus).toEqual({
      status: "unavailable",
      reason: "No safe Prometheus query metadata",
    });
  });
});
