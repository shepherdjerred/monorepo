import { afterEach, expect, test, vi } from "vitest";
import { stat } from "node:fs/promises";
import {
  withDeliveryTofuStack,
  deliveryTofuChanges,
  privateProviderJson,
} from "./delivery-stack.ts";
afterEach(() => vi.unstubAllEnvs());
test("malformed private provider JSON never appears in syntax failure diagnostics", () => {
  const privateValue = "fixture-sensitive-provider-value";
  expect(() => privateProviderJson(privateValue)).toThrow(
    "raw output withheld",
  );
  try {
    privateProviderJson(privateValue);
  } catch (error) {
    expect(String(error)).not.toContain(privateValue);
  }
});
test("rejects operator-only and validation-only stacks before resolving any credentials", async () => {
  for (const stack of [
    "argocd",
    "dockerhub-tokens",
    "google",
    "application-secrets",
    "unknown",
  ])
    await expect(
      withDeliveryTofuStack(stack, async () => {
        throw new Error("Rejected stacks must not reach effect admission");
      }),
    ).rejects.toThrow();
});
test("saved execution uses native locks, private disposable state, and only provider/state credentials", async () => {
  for (const key of [
    "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
    "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
  ])
    vi.stubEnv(key, "fixture-provider-value");
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "fixture-api-must-not-reach-provider");
  vi.stubEnv(
    "OP_SERVICE_ACCOUNT_TOKEN",
    "fixture-vault-must-not-reach-provider",
  );
  const seen: string[][] = [];
  let directory = "";
  await withDeliveryTofuStack(
    "cloudflare",
    async (context) => {
      directory = context.workspace;
      const metadata = await stat(directory);
      expect(metadata.mode & 0o077).toBe(0);
      expect(await context.state()).toEqual({ lineage: "original", serial: 4 });
      await context.command([
        "apply",
        "-input=false",
        "-lock-timeout=5m",
        "/private/plan.tfplan",
      ]);
    },
    async (command, environment) => {
      expect(environment["DELIVERY_EXECUTOR_TOKEN"]).toBeUndefined();
      expect(environment["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
      expect(environment["CLOUDFLARE_API_TOKEN"]).toBe(
        "fixture-provider-value",
      );
      expect(environment["AWS_ACCESS_KEY_ID"]).toBe("fixture-provider-value");
      seen.push([...command]);
      return {
        stdout: JSON.stringify({
          lineage: "original",
          serial: 4,
          secret: "never returned",
        }),
        exitCode: 0,
      };
    },
  );
  expect(seen.map((command) => command.slice(2))).toEqual([
    ["init", "-input=false", "-lockfile=readonly"],
    ["state", "pull"],
    ["apply", "-input=false", "-lock-timeout=5m", "/private/plan.tfplan"],
  ]);
  await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});
test("public review counts replacement once and reject unknown provider actions", () => {
  expect(
    deliveryTofuChanges({
      resource_changes: [
        { change: { actions: ["create"] } },
        { change: { actions: ["delete", "create"] } },
        { change: { actions: ["update"] } },
        { change: { actions: ["delete"] } },
      ],
    }),
  ).toEqual({ create: 1, replace: 1, update: 1, delete: 1 });
  expect(() =>
    deliveryTofuChanges({
      resource_changes: [{ change: { actions: ["unknown"] } }],
    }),
  ).toThrow();
});
