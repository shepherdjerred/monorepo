import { describe, test, expect } from "bun:test";
import { health } from "#lib/pinchtab-cli/client.ts";
import { screenshotCommand } from "#commands/screenshot/screenshot.ts";

/**
 * Full end-to-end: boots the lightest real package (stocks-sjer-red, a
 * plain Astro site) and drives a real PinchTab daemon to screenshot it.
 *
 * PinchTab is a personal-machine daemon, so this suite lives in the
 * local-only `test:integration` command (like the `deployed` catalog drift
 * test) — it is deliberately NOT part of `bun run verify`/CI, which have no
 * browser instance. Rather than silently green-skipping when PinchTab is
 * absent (which makes "tests passed" indistinguishable from "tests didn't
 * run"), the suite fails fast with an actionable message so the prerequisite
 * is required, not optional.
 */
const pinchtabHealth = await health();
if (!pinchtabHealth.success) {
  throw new Error(
    "toolkit screenshot integration test requires a running PinchTab instance. " +
      "Start one with `pinchtab instance start --profile default --mode headless` " +
      `(check \`pinchtab instances\`). Health check failed: ${pinchtabHealth.error ?? "unknown error"}`,
  );
}

describe("toolkit screenshot (real PinchTab)", () => {
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
});
