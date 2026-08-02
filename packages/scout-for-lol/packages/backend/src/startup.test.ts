import { describe, expect, mock, test } from "bun:test";
import { runBackendStartup } from "./startup.ts";

describe("backend startup", () => {
  test("validates champion assets and private fonts before serving", async () => {
    const calls: string[] = [];
    const shutdownHttpServer = mock(() => Promise.resolve());

    const runtime = await runBackendStartup({
      validateChampionAssets: async () => {
        calls.push("champion-assets");
      },
      ensureClassicFontsConfigured: async () => {
        calls.push("classic-fonts");
      },
      startHttpServer: async () => {
        calls.push("http-server");
        return { shutdownHttpServer };
      },
      startDiscord: async () => {
        calls.push("discord");
      },
    });

    expect(calls).toEqual([
      "champion-assets",
      "classic-fonts",
      "http-server",
      "discord",
    ]);
    expect(runtime.shutdownHttpServer).toBe(shutdownHttpServer);
  });

  test("propagates private-font failure before health or Discord start", async () => {
    const fontFailure = new Error("private font checksum mismatch");
    const startHttpServer = mock(async () => ({
      shutdownHttpServer: () => Promise.resolve(),
    }));
    const startDiscord = mock(() => Promise.resolve());

    await expect(
      runBackendStartup({
        validateChampionAssets: () => Promise.resolve(),
        ensureClassicFontsConfigured: async () => {
          throw fontFailure;
        },
        startHttpServer,
        startDiscord,
      }),
    ).rejects.toBe(fontFailure);

    expect(startHttpServer).not.toHaveBeenCalled();
    expect(startDiscord).not.toHaveBeenCalled();
  });
});
