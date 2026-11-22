import { describe, expect, test } from "vitest";
import { TailscaleClient } from "@shepherdjerred/ops-clients/tailscale.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

describe("TailscaleClient", () => {
  test("lists devices with apiKey, default tailnet '-', and normalized expiry", async () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const { fetch, requests } = sequence({
      devices: [
        {
          id: "d1",
          name: "macbook.tailnet-1a49.ts.net",
          hostname: "macbook",
          os: "macOS",
          clientVersion: "1.88.1",
          updateAvailable: true,
          connectedToControl: true,
          keyExpiryDisabled: false,
          lastSeen: "2026-09-24T00:00:00Z",
          expires: "2026-10-04T12:00:00Z",
          tags: [],
          addresses: ["100.64.0.1"],
        },
        {
          id: "d2",
          name: "karpathy.tailnet-1a49.ts.net",
          hostname: "karpathy",
          os: "linux",
          clientVersion: "1.88.2",
          updateAvailable: false,
          connectedToControl: false,
          keyExpiryDisabled: true,
          lastSeen: "2026-09-23T23:50:00Z",
          expires: "0001-01-01T00:00:00Z",
          tags: ["tag:server"],
          addresses: ["100.64.0.2"],
        },
      ],
    });

    const client = new TailscaleClient({ apiKey: "tskey-test", fetch });
    const devices = await client.listDevices(now);

    expect(requests[0]?.url).toBe(
      "https://api.tailscale.com/api/v2/tailnet/-/devices?fields=all",
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tskey-test");
    expect(devices).toEqual([
      {
        id: "d1",
        name: "macbook.tailnet-1a49.ts.net",
        hostname: "macbook",
        os: "macOS",
        clientVersion: "1.88.1",
        updateAvailable: true,
        online: true,
        connectedToControl: true,
        lastSeen: "2026-09-24T00:00:00Z",
        expires: "2026-10-04T12:00:00Z",
        daysToExpiry: 10,
        tags: [],
        addresses: ["100.64.0.1"],
      },
      {
        id: "d2",
        name: "karpathy.tailnet-1a49.ts.net",
        hostname: "karpathy",
        os: "linux",
        clientVersion: "1.88.2",
        updateAvailable: false,
        online: false,
        connectedToControl: false,
        lastSeen: "2026-09-23T23:50:00Z",
        expires: null,
        daysToExpiry: null,
        tags: ["tag:server"],
        addresses: ["100.64.0.2"],
      },
    ]);
  });

  test("exchanges OAuth credentials and caches the access token", async () => {
    const { fetch, requests } = sequence(
      { access_token: "oauth-tok", expires_in: 3600 },
      { devices: [] },
      { devices: [] },
    );

    const client = new TailscaleClient({
      oauth: { clientId: "cid", clientSecret: "csec" },
      tailnet: "example.ts.net",
      fetch,
    });

    await expect(client.listDevices()).resolves.toEqual([]);
    await expect(client.devices()).resolves.toEqual([]);
    expect(requests).toHaveLength(3);
    expect(requests[0]?.url).toBe(
      "https://api.tailscale.com/api/v2/oauth/token",
    );
    expect(requests[0]?.method).toBe("POST");
    expect(requests[1]?.url).toBe(
      "https://api.tailscale.com/api/v2/tailnet/example.ts.net/devices?fields=all",
    );
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer oauth-tok");
    expect(requests[2]?.headers.get("authorization")).toBe("Bearer oauth-tok");
  });
});
