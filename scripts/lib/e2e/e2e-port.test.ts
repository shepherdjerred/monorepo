import net from "node:net";
import { describe, expect, test } from "vitest";
import {
  findFreeLoopbackPortSync,
  resolvePlaywrightPort,
  worktreeBasePort,
} from "./e2e-port.ts";

function occupyPort(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address !== "object") {
        reject(new Error("expected bound address"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

describe("e2e-port", () => {
  test("hashes distinct checkouts and namespaces to stable ports in [20000, 49999]", () => {
    const portA = worktreeBasePort("/repo/worktree-a", "DELIVERY_E2E_PORT");
    const portB = worktreeBasePort("/repo/worktree-b", "DELIVERY_E2E_PORT");
    const modelPortA = worktreeBasePort(
      "/repo/worktree-a",
      "DELIVERY_MODEL_E2E_PORT",
    );
    expect(portA).toBeGreaterThanOrEqual(20_000);
    expect(portA).toBeLessThan(50_000);
    expect(portA).not.toBe(portB);
    expect(portA).not.toBe(modelPortA);
  });

  test("skips occupied TCP ports and advances to the next free port", async () => {
    const occupied = await occupyPort();
    try {
      const fallback = findFreeLoopbackPortSync([
        occupied.port,
        occupied.port + 1 <= 65_535 ? occupied.port + 1 : 25_000,
      ]);
      expect(fallback).not.toBe(occupied.port);
    } finally {
      await occupied.close();
    }
  });

  test("caches resolved port for Playwright workers and disables reuseExistingServer unless explicit", () => {
    const env: Record<string, string | undefined> = {};
    const first = resolvePlaywrightPort({
      checkout: "/repo/wt-1",
      envVar: "DELIVERY_E2E_PORT",
      env,
    });
    expect(first.explicit).toBe(false);
    expect(first.reuseExistingServer).toBe(false);
    expect(env["_PLAYWRIGHT_RESOLVED_DELIVERY_E2E_PORT"]).toBe(
      String(first.port),
    );

    const worker = resolvePlaywrightPort({
      checkout: "/repo/wt-1",
      envVar: "DELIVERY_E2E_PORT",
      env,
    });
    expect(worker.port).toBe(first.port);
    expect(worker.reuseExistingServer).toBe(false);

    const explicitLocal = resolvePlaywrightPort({
      checkout: "/repo/wt-1",
      envVar: "DELIVERY_E2E_PORT",
      env: { DELIVERY_E2E_PORT: "17353" },
    });
    expect(explicitLocal).toEqual({
      port: 17_353,
      explicit: true,
      reuseExistingServer: true,
    });

    const explicitCi = resolvePlaywrightPort({
      checkout: "/repo/wt-1",
      envVar: "DELIVERY_E2E_PORT",
      env: { DELIVERY_E2E_PORT: "17353", CI: "true" },
    });
    expect(explicitCi.reuseExistingServer).toBe(false);
  });
});
