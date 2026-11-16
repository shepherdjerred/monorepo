import { describe, expect, test } from "vitest";
import { resolvePackage } from "#lib/screenshot/catalog.ts";
import {
  allocateFreePort,
  buildIsolatedDevLaunch,
} from "#lib/screenshot/dev-server.ts";

describe("screenshot dev-server port allocation", () => {
  test("returns preferredPort when it is free and falls back when busy", async () => {
    const freeCandidate = await allocateFreePort();
    const reused = await allocateFreePort(freeCandidate);
    expect(reused).toBe(freeCandidate);

    const occupied = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("busy"),
    });
    const busyPort = occupied.port;
    if (busyPort === undefined) {
      await occupied.stop(true);
      throw new Error("expected bound TCP port");
    }
    try {
      const fallback = await allocateFreePort(busyPort);
      expect(fallback).not.toBe(busyPort);
      expect(fallback).toBeGreaterThanOrEqual(1);
      expect(fallback).toBeLessThanOrEqual(65_535);
    } finally {
      await occupied.stop(true);
    }
  });

  test("honors excludedPorts when selecting a fallback port", async () => {
    const candidate = await allocateFreePort();
    const other = await allocateFreePort(candidate, new Set([candidate]));
    expect(other).not.toBe(candidate);
  });

  test("injects --ignore-lock --port for Astro entries and --strictPort for Vite entries", async () => {
    const astroLaunch = await buildIsolatedDevLaunch(
      resolvePackage("sjer-red"),
    );
    expect(astroLaunch.command).toEqual([
      "bun",
      "run",
      "dev",
      "--",
      "--ignore-lock",
      "--port",
      String(astroLaunch.port),
    ]);

    const viteLaunch = await buildIsolatedDevLaunch(
      resolvePackage("mario-kart-frontend"),
    );
    expect(viteLaunch.command).toEqual([
      "bun",
      "run",
      "dev",
      "--",
      "--port",
      String(viteLaunch.port),
      "--strictPort",
    ]);
  });

  test("allocates 4 distinct Scout dev ports in environment overrides", async () => {
    const launch = await buildIsolatedDevLaunch(resolvePackage("scout-app"));
    const ports = [
      Number(launch.env["SCOUT_DEV_WEB_PORT"]),
      Number(launch.env["SCOUT_DEV_BACKEND_PORT"]),
      Number(launch.env["SCOUT_DEV_TEMPORAL_PORT"]),
      Number(launch.env["SCOUT_DEV_TEMPORAL_UI_PORT"]),
    ];
    expect(ports[0]).toBe(launch.port);
    expect(new Set(ports).size).toBe(4);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(1);
      expect(port).toBeLessThanOrEqual(65_535);
    }
  });
});
