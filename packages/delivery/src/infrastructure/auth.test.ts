import { describe, expect, test } from "vitest";
import { authenticate, requireScope } from "./auth.ts";
import type { RuntimeConfig } from "./config.ts";

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
});
