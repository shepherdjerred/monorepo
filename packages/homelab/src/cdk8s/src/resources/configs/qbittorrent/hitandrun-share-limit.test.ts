import { describe, it, expect } from "bun:test";
import path from "node:path";

// Exercises the real script's required_hours() formula in isolation by sourcing
// it (network calls and the QBT_USERNAME/QBT_PASSWORD checks live in main(),
// which only runs when the script is executed directly — see the
// `[ "${BASH_SOURCE[0]}" = "${0}" ]` guard at the bottom of the script).
const scriptPath = path.join(import.meta.dir, "hitandrun-share-limit.sh");

async function requiredHours(sizeGb: number): Promise<number> {
  const proc = Bun.spawn(
    [
      "bash",
      "-c",
      `source "$1"; required_hours "$2"`,
      "_",
      scriptPath,
      String(sizeGb),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `required_hours(${String(sizeGb)}) exited ${String(code)}: ${stderr}`,
    );
  }
  return Number.parseFloat(stdout.trim());
}

describe("hitandrun-share-limit.sh required_hours (PrivateHD Hit & Run formula)", () => {
  it("uses the flat 72h floor at or below 1GB", async () => {
    expect(await requiredHours(0.5)).toBeCloseTo(72, 1);
    expect(await requiredHours(1)).toBeCloseTo(72, 1);
  });

  it("uses the linear branch (72 + 2x) between 1GB and 50GB", async () => {
    // Matches the currently-seeding Obsession 2025 WEB-DL torrent (20.9GB).
    expect(await requiredHours(20.9)).toBeCloseTo(113.8, 1);
    expect(await requiredHours(16.4)).toBeCloseTo(104.8, 1);
  });

  it("agrees closely across the 50GB branch boundary", async () => {
    const justBelow = await requiredHours(49.999);
    const at = await requiredHours(50);
    expect(Math.abs(at - justBelow)).toBeLessThan(0.1);
  });

  it("uses the logarithmic branch (100*ln(x) - 219.2023) at or above 50GB", async () => {
    // Matches the currently at-risk Transformers torrents (~80-85GB), which need
    // ~9.1-9.4 days -- well past qBittorrent's flat 7-day global cap.
    expect(await requiredHours(83.2)).toBeCloseTo(222.9, 0);
    expect(await requiredHours(85)).toBeCloseTo(225.1, 0);
    expect(await requiredHours(80.7)).toBeCloseTo(219.9, 0);
  });

  it("stays within the tracker's published chart at 200GB (~13 days)", async () => {
    const hours = await requiredHours(200);
    expect(hours).toBeGreaterThan(290);
    expect(hours).toBeLessThan(320);
  });
});
