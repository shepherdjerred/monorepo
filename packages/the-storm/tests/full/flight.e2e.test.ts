import path from "node:path";
import { expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { eventually, status } from "#e2e/harness/rwf-match.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import { recordFlight } from "#e2e/harness/flight.ts";

test(
  "records bot Flight Recorder spans through native JFR commands",
  { timeout: 180_000 },
  async ({ rcon, server }) => {
    await eventually(
      "the initial map",
      async () => {
        const current = await status(rcon);
        return current.ready;
      },
      120_000,
    );
    expect(await rcon.command("rwf admin showcase 8")).toContain(
      "Showcase of 8",
    );
    await eventually(
      "the live showcase",
      async () => {
        const current = await status(rcon);
        return current.phase === "Live";
      },
      60_000,
    );
    const match = await status(rcon);
    // Own the recording's lifetime before fixture teardown; this is diagnostic plumbing only.
    await recordFlight(server, match.matchId, 10_000);
    const output = path.join(
      packageRoot,
      ".cache/e2e/capacity/profiles",
      match.matchId,
    );
    const summary = await Bun.file(
      path.join(output, "flight-summary.txt"),
    ).text();
    expect(summary).toMatch(/storm\.BotThink\s+[1-9]\d*/u);
    expect(Bun.file(path.join(output, "flight.jfr")).size).toBeGreaterThan(0);
  },
);
