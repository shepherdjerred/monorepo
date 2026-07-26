import { describe, test, expect } from "bun:test";
import { health } from "#lib/pinchtab-cli/client.ts";
import { screenshotCommand } from "#commands/screenshot/screenshot.ts";

/**
 * Full end-to-end: boots the lightest real package (stocks-sjer-red, a
 * plain Astro site) and drives a real PinchTab daemon to screenshot it.
 * Unlike CI's shared infra (Grafana, PagerDuty, Bugsink), PinchTab is a
 * personal-machine daemon — CI cannot assume one is running, so this suite
 * skips (not fails) when it isn't, rather than being a permanent red X.
 */
const pinchtabHealth = await health();
const pinchtabAvailable = pinchtabHealth.success;

describe.skipIf(!pinchtabAvailable)(
  "toolkit screenshot (real PinchTab)",
  () => {
    test("screenshots stocks-sjer-red and produces a real PNG", async () => {
      const result = await screenshotCommand({ alias: "stocks-sjer-red" });

      expect(result.path).toMatch(/\.png$/);
      const file = Bun.file(result.path);
      expect(await file.exists()).toBe(true);
      const bytes = await file.arrayBuffer();
      // PNG magic bytes.
      const signature = new Uint8Array(bytes.slice(0, 8));
      expect([...signature]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

      await file.delete();
    }, 120_000);
  },
);

if (!pinchtabAvailable) {
  console.log(
    `Skipping toolkit screenshot integration test — PinchTab not reachable: ${pinchtabHealth.error ?? "unknown error"}`,
  );
}
