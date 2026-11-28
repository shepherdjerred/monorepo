import { afterEach, describe, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { FlagsProvider } from "@shepherdjerred/feature-flags/providers/flags.ts";
import { authenticate, requireScope } from "./auth.ts";
import { behaviorConfig, type RuntimeConfig } from "./config.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

const config: RuntimeConfig = {
  publicOrigin: "https://delivery.example.com",
  machineCredentials: [
    {
      token: "test-publisher-credential-32-characters",
      principal: { id: "ci", kind: "machine", scopes: ["read", "publish"] },
    },
  ],
  writesEnabled: async () => true,
  enabledEnvironments: async () => ["arcade/prod"],
  operatorLogins: async () => ["operator@example.com"],
  trustedProxyAddresses: async () => ["127.0.0.1"],
};
describe("Delivery authentication", () => {
  test("untrusted clients cannot spoof Tailscale identity", async () => {
    const request = new Request(
      "https://delivery.example.com/api/v1/identity",
      { headers: { "Tailscale-User-Login": "operator@example.com" } },
    );
    await expect(
      authenticate(request, "10.0.0.7", config),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const principal = await authenticate(request, "127.0.0.1", config);
    expect(principal.kind).toBe("human");
  });
  test("operator allowlist revocation takes effect immediately", async () => {
    const request = new Request(
      "https://delivery.example.com/api/v1/identity",
      { headers: { "Tailscale-User-Login": "operator@example.com" } },
    );
    await expect(
      authenticate(request, "127.0.0.1", {
        ...config,
        operatorLogins: async () => [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  test("human mutations require the configured origin", async () => {
    const request = new Request(
      "https://delivery.example.com/api/v1/deployments",
      {
        method: "POST",
        headers: {
          "Tailscale-User-Login": "operator@example.com",
          Origin: "https://attacker.example.com",
        },
      },
    );
    await expect(
      authenticate(request, "127.0.0.1", config),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  test("machine identity is scoped and cannot inherit spoofed human permissions", async () => {
    const request = new Request(
      "https://delivery.example.com/api/v1/deployments",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-publisher-credential-32-characters",
          "Tailscale-User-Login": "operator@example.com",
        },
      },
    );
    const principal = await authenticate(request, "127.0.0.1", config);
    expect(principal.id).toBe("ci");
    expect(() => requireScope(principal, "deploy")).toThrow("lacks deploy");
    expect(() => requireScope(principal, "approve")).toThrow();
  });
  test("invalid bearer never falls through to proxy identity", async () => {
    const request = new Request(
      "https://delivery.example.com/api/v1/identity",
      {
        headers: {
          Authorization: "Bearer invalid",
          "Tailscale-User-Login": "operator@example.com",
        },
      },
    );
    await expect(
      authenticate(request, "127.0.0.1", config),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("transient flag snapshot unavailability surfaces UNAVAILABLE instead of FORBIDDEN", async () => {
    let snapshotAvailable = true;
    let allowedLogins = ["operator@example.com"];
    const provider = new FlagsProvider({
      url: "https://flags.example.com",
      deployment: "delivery/prod",
      pollIntervalSeconds: 3600,
      fetcher: () => {
        if (!snapshotAvailable) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            headers: { get: () => null },
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              deployment: "delivery/prod",
              revision: 1,
              flags: [
                {
                  type: "variant",
                  key: "delivery-operator-logins",
                  value: JSON.stringify(allowedLogins),
                },
                {
                  type: "boolean",
                  key: "delivery-writes-enabled",
                  default: true,
                  rollouts: [],
                },
              ],
            }),
        });
      },
    });
    await initFeatureFlags({
      provider,
      environment: { FEATURE_FLAGS_MODE: "disabled" },
    });

    const request = new Request(
      "https://delivery.example.com/api/v1/deployments/dep-1",
      { headers: { "Tailscale-User-Login": "operator@example.com" } },
    );
    const runtimeConfig: RuntimeConfig = {
      ...config,
      operatorLogins: () =>
        behaviorConfig("production").value("operatorLogins"),
    };

    const authorized = await authenticate(request, "127.0.0.1", runtimeConfig);
    expect(authorized.id).toBe("operator@example.com");

    snapshotAvailable = false;
    await expect(
      authenticate(request, "127.0.0.1", runtimeConfig),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Operator authorization snapshot is temporarily unavailable",
    });
    await expect(
      behaviorConfig("production").value("writesEnabled"),
    ).resolves.toBe(false);

    snapshotAvailable = true;
    allowedLogins = [];
    await expect(
      authenticate(request, "127.0.0.1", runtimeConfig),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Operator identity is not authorized",
    });
  });
});
