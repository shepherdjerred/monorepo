import { expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import {
  eventually,
  status,
  transcript,
  waitForLobby,
} from "#e2e/harness/rwf-match.ts";

/** Extended Paper acceptance: Brigadier commands control the actual Citizens bot draft. */
test("map presets and team overrides control the next bot draft", async ({
  bot,
  rcon,
}) => {
  // Imported maps prepare asynchronously after Paper reports that startup is complete.
  await eventually(
    "initial map preparation",
    async () => {
      const current = await status(rcon);
      return current.ready && current.phase === "Lobby";
    },
    120_000,
  );
  const log = transcript(bot);
  const automatic = await rcon.command("rwf admin size auto");
  const map = z
    .object({ teams: z.coerce.number().int().min(2) })
    .parse(/: (?<teams>\d+) teams/u.exec(automatic)?.groups);
  const recommendation = z
    .object({ large: z.coerce.number().int().positive() })
    .parse(/large (?<large>\d+) total/u.exec(automatic)?.groups);
  expect(automatic).toContain(
    `Next draft: auto, ${recommendation.large.toString()} total`,
  );
  const total = map.teams * 6;
  const requested = await rcon.command("rwf admin size team 6");
  expect(requested).toContain(`team 6, ${total.toString()} total (6/team)`);
  try {
    // A non-operator may inspect recommendations, but cannot change this shared lobby.
    bot.chat("/rwf admin size small");
    bot.chat("/rwf size");
    await log.until(/Next draft: team 6,/u);
    bot.chat("/rwf join");
    await eventually("countdown", async () => {
      const current = await status(rcon);
      return current.phase === "Countdown";
    });
    await eventually(
      "the Citizens bots to arrive",
      async () => {
        const current = await status(rcon);
        return current.bots === total - 1;
      },
      20_000,
    );
    const pending = await rcon.command("rwf admin size large");
    expect(pending).toContain(`target is already ${total.toString()}`);
    await eventually(
      "live match with the requested team size",
      async () => {
        const current = await status(rcon);
        return current.phase === "Live";
      },
      30_000,
    );
    const live = await status(rcon);
    expect([live.humans, live.bots]).toEqual([1, total - 1]);
    await Bun.write(
      ".cache/rwf-sizing/acceptance.txt",
      [
        automatic,
        requested,
        pending,
        `Live roster: ${live.humans.toString()} human, ${live.bots.toString()} bots`,
      ].join("\n"),
    );
  } finally {
    bot.chat("/rwf leave");
    await waitForLobby(rcon);
    // Restore the explicit eight-combatant profile for the other full-suite cases.
    await rcon.command("rwf admin size team 4");
  }
}, 240_000);
