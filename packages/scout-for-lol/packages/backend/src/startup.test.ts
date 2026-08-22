import { describe, expect, test, vi } from "vitest";
import { runBackendStartup } from "./startup.ts";

describe("backend startup", () => {
  test("validates champion assets before serving", async () => {
    const calls: string[] = [];
    const shutdownHttpServer = vi.fn(() => Promise.resolve());

    const runtime = await runBackendStartup({
      validateChampionAssets: async () => {
        calls.push("champion-assets");
      },
      startHttpServer: async () => {
        calls.push("http-server");
        return { shutdownHttpServer };
      },
      startDiscord: async () => {
        calls.push("discord");
      },
    });

    expect(calls).toEqual(["champion-assets", "http-server", "discord"]);
    expect(runtime.shutdownHttpServer).toBe(shutdownHttpServer);
  });

  test("reconciles the report lake before serving", async () => {
    const calls: string[] = [];
    const runtime = await runBackendStartup({
      validateChampionAssets: async () => {
        calls.push("champion-assets");
      },
      ensureReportLakeReady: async () => {
        calls.push("report-lake");
      },
      startHttpServer: async () => {
        calls.push("http-server");
        return { shutdownHttpServer: () => Promise.resolve() };
      },
      startDiscord: async () => {
        calls.push("discord");
      },
    });

    expect(calls).toEqual([
      "champion-assets",
      "report-lake",
      "http-server",
      "discord",
    ]);
    await runtime.shutdownHttpServer();
  });

  test("propagates asset-validation failure before health or Discord start", async () => {
    const assetFailure = new Error("champion asset missing");
    const startHttpServer = vi.fn(async () => ({
      shutdownHttpServer: () => Promise.resolve(),
    }));
    const startDiscord = vi.fn(() => Promise.resolve());

    await expect(
      runBackendStartup({
        validateChampionAssets: async () => {
          throw assetFailure;
        },
        startHttpServer,
        startDiscord,
      }),
    ).rejects.toBe(assetFailure);

    expect(startHttpServer).not.toHaveBeenCalled();
    expect(startDiscord).not.toHaveBeenCalled();
  });
});
