import { describe, expect, mock, test } from "bun:test";
import { runBackendStartup } from "./startup.ts";

describe("backend startup", () => {
  test("validates champion assets before serving", async () => {
    const calls: string[] = [];
    const shutdownHttpServer = mock(() => Promise.resolve());

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

  test("propagates asset-validation failure before health or Discord start", async () => {
    const assetFailure = new Error("champion asset missing");
    const startHttpServer = mock(async () => ({
      shutdownHttpServer: () => Promise.resolve(),
    }));
    const startDiscord = mock(() => Promise.resolve());

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
