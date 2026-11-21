import { afterEach, describe, expect, it } from "vitest";

import { AlertmanagerClient } from "#infrastructure/alertmanager-client";

const activeServers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server !== undefined) await server.stop();
  }
});

describe("AlertmanagerClient", () => {
  it("queries only ledger receivers via URLSearchParams and parses receivers", async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url));
        return Response.json([
          {
            annotations: { summary: "Disk is full" },
            endsAt: "0001-01-01T00:00:00Z",
            fingerprint: "fp-disk",
            startsAt: "2026-08-08T18:00:00Z",
            labels: { alertname: "DiskFull", severity: "warning" },
            receivers: [{ name: "alerts" }],
            status: { inhibitedBy: [], silencedBy: [], state: "active" },
          },
        ]);
      },
    });
    activeServers.push(server);

    const client = new AlertmanagerClient(
      `http://127.0.0.1:${String(server.port)}/`,
    );
    const alerts = await client.activeAlerts();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v2/alerts");
    expect(requests[0]?.searchParams.get("receiver")).toBe(
      "^(alerts|alerts-ledger-only|postal-fallback)$",
    );
    expect(alerts[0]?.receivers).toEqual([{ name: "alerts" }]);
  });
});
