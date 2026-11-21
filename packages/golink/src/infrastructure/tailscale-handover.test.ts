import { describe, expect, test } from "vitest";
import {
  reconcileTailscaleHostnameHandover,
  TailscaleHandoverBootstrapSchema,
  type HandoverFetch,
  type TailscaleHandoverResult,
} from "./tailscale-handover.ts";

const TEST_CONFIG = TailscaleHandoverBootstrapSchema.parse({
  TS_OAUTH_CLIENT_ID: "oauth-client-id",
  TS_OAUTH_CLIENT_SECRET: "oauth-client-secret",
  TS_STATE_SECRET_NAME: "golink-tailscale-state",
  TS_EXPECTED_HOSTNAME: "go",
  TS_EXPECTED_FQDN: "go.tailnet-1a49.ts.net",
  TAILSCALE_API_BASE_URL: "https://tailscale.example.test",
});

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function runHandover(
  fetchImpl: HandoverFetch,
): Promise<TailscaleHandoverResult> {
  return reconcileTailscaleHostnameHandover({
    config: TEST_CONFIG,
    k8sBaseUrl: "https://k8s.example.test",
    k8sNamespace: "golink",
    k8sToken: "sa-token",
    k8sCaCert: "ca-pem",
    fetchImpl,
    sleepMs: () => Promise.resolve(),
  });
}

function handleCommonAuthAndAbsentSecret(
  url: string,
  includeAbsentSecret: boolean,
): Response | undefined {
  if (includeAbsentSecret && url.endsWith("/secrets/golink-tailscale-state")) {
    return jsonResponse({ message: "not found" }, 404);
  }
  return url.endsWith("/api/v2/oauth/token")
    ? jsonResponse({ access_token: "oauth-token" })
    : undefined;
}

const untaggedDeviceFetch: HandoverFetch = (url) => {
  const common = handleCommonAuthAndAbsentSecret(url, true);
  if (common !== undefined) {
    return Promise.resolve(common);
  }
  if (url.endsWith("/api/v2/tailnet/-/devices")) {
    return Promise.resolve(
      jsonResponse({
        devices: [
          {
            id: "human-device",
            hostname: "go",
            name: "go.tailnet-1a49.ts.net",
          },
        ],
      }),
    );
  }
  throw new Error(`Unexpected URL: ${url}`);
};

describe("reconcileTailscaleHostnameHandover", () => {
  test("reuses persisted state immediately when golink-tailscale-state already owns go.tailnet-1a49.ts.net", async () => {
    const calls: string[] = [];
    const fetchImpl: HandoverFetch = (url) => {
      calls.push(url);
      return Promise.resolve(
        jsonResponse({
          metadata: { resourceVersion: "42" },
          data: {
            "_current-profile": b64("profile-1"),
            device_fqdn: b64("go.tailnet-1a49.ts.net."),
            device_id: b64("node-active"),
          },
        }),
      );
    };

    const result = await runHandover(fetchImpl);
    expect(result).toEqual({
      action: "reused-persisted-state",
      fqdn: "go.tailnet-1a49.ts.net",
    });
    expect(calls).toEqual([
      "https://k8s.example.test/api/v1/namespaces/golink/secrets/golink-tailscale-state",
    ]);
  });

  test("deletes the legacy go device and verifies release when state Secret is absent", async () => {
    const requests: string[] = [];
    let deleted = false;

    const fetchImpl: HandoverFetch = (url, init) => {
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);

      const common = handleCommonAuthAndAbsentSecret(url, true);
      if (common !== undefined) {
        return Promise.resolve(common);
      }
      if (url.endsWith("/api/v2/tailnet/-/devices")) {
        const devices = deleted
          ? [
              {
                id: "other-device",
                hostname: "tracker",
                name: "tracker.tailnet-1a49.ts.net",
                tags: ["tag:k8s"],
              },
            ]
          : [
              {
                id: "legacy-go-id",
                nodeId: "legacy-node",
                hostname: "go",
                name: "go.tailnet-1a49.ts.net",
                tags: ["tag:k8s-operator"],
              },
            ];
        return Promise.resolve(jsonResponse({ devices }));
      }
      if (method === "DELETE" && url.endsWith("/api/v2/device/legacy-go-id")) {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };

    const result = await runHandover(fetchImpl);
    expect(result).toEqual({
      action: "prepared-fresh-registration",
      deletedDeviceIds: ["legacy-go-id"],
      resetStateSecret: false,
    });
    expect(requests).toContain(
      "DELETE https://tailscale.example.test/api/v2/device/legacy-go-id",
    );
  });

  test("clears suffixed go-1 state Secret and deletes both suffixed and conflicting go devices", async () => {
    const methods: string[] = [];
    const removed = new Set<string>();

    const fetchImpl: HandoverFetch = (url, init) => {
      const method = init?.method ?? "GET";
      methods.push(`${method} ${url}`);

      const common = handleCommonAuthAndAbsentSecret(url, false);
      if (common !== undefined) {
        return Promise.resolve(common);
      }
      if (method === "GET" && url.endsWith("/secrets/golink-tailscale-state")) {
        return Promise.resolve(
          jsonResponse({
            metadata: { resourceVersion: "77" },
            data: {
              "_current-profile": b64("profile-suffixed"),
              device_fqdn: b64("go-1.tailnet-1a49.ts.net."),
              device_id: b64("suffixed-node"),
            },
          }),
        );
      }
      if (method === "PUT" && url.endsWith("/secrets/golink-tailscale-state")) {
        return Promise.resolve(jsonResponse({ data: {} }));
      }
      if (url.endsWith("/api/v2/tailnet/-/devices")) {
        const all = [
          {
            id: "legacy-go",
            nodeId: "legacy-node",
            hostname: "go",
            name: "go.tailnet-1a49.ts.net",
            tags: ["tag:k8s-operator"],
          },
          {
            id: "suffixed-go-1",
            nodeId: "suffixed-node",
            hostname: "go",
            name: "go-1.tailnet-1a49.ts.net",
            tags: ["tag:k8s"],
          },
        ];
        return Promise.resolve(
          jsonResponse({
            devices: all.filter((device) => !removed.has(device.id)),
          }),
        );
      }
      if (method === "DELETE" && url.includes("/api/v2/device/")) {
        removed.add(url.split("/").at(-1) ?? "");
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };

    const result = await runHandover(fetchImpl);
    expect(result).toEqual({
      action: "prepared-fresh-registration",
      deletedDeviceIds: ["legacy-go", "suffixed-go-1"],
      resetStateSecret: true,
    });
    expect(methods).toContain(
      "PUT https://k8s.example.test/api/v1/namespaces/golink/secrets/golink-tailscale-state",
    );
  });

  test("refuses to delete a conflicting device that lacks cluster tags", async () => {
    await expect(runHandover(untaggedDeviceFetch)).rejects.toThrow(
      "not cluster-owned",
    );
  });
});
