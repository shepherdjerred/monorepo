import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { ListOutputSchema } from "#e2e/harness/rcon-output.ts";
import {
  eventually,
  matchRows,
  settledMatch,
  status,
  transcript,
  type Transcript,
  waitForLobby,
} from "#e2e/harness/rwf-match.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";
import {
  balance,
  type ClientView,
  clientView,
  debug,
  diamonds,
  escaped,
  gzipLines,
  ownedYaml,
  type Personality,
  personalities,
  personalityStats,
  plain,
  readRecording,
  type Recording,
  type StatsRow,
  type Team,
} from "#e2e/harness/rwfbots.ts";
import { serverLogs, type ServerInfo } from "#e2e/harness/server.ts";
import { querySqlite } from "#e2e/harness/storm-data.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/**
 * Search and Destroy with rwfbots on the real server: Citizens player NPCs
 * fill a lone human's countdown, carry their personalities' names and skins
 * and rwf's bot marker, stay off the online list, move, fight, arm bombs and
 * play a match to its result, which rates the personalities, writes a trace
 * and pays only the human. A watcher follows a bots-only showcase, and a live
 * match the last human leaves is stopped unpaid with every bot despawned.
 *
 * The full lane boots every shipped module plus rwf and rwfbots with the
 * owned rwf.yml (targetCombatants 8) under the suite's short countdown. What
 * the bots do is the think stack's own choice, so behavioural checks wait for
 * the match to finish rather than for a fixed moment; the poison forces a
 * result after ten quiet minutes.
 */

const dimension = `minecraft:${rwfTestSettings.world}`;
const startingBalance = 500;
/** How long a bots' match may take: the poison ends a quiet one after 10 min. */
const matchBudgetMs = 14 * 60_000;

const OwnedRwfSchema = z.object({
  match: z.object({ targetCombatants: z.number().int().positive() }),
});
const OwnedBotsSchema = z.object({
  think: z.object({ maxDecisionAgeTicks: z.number().int().positive() }),
});
const MatchTimesSchema = z.array(
  z.object({ started_at: z.number(), ended_at: z.number() }),
);

const HealthSchema = z.string().transform((text, context) => {
  const value = /: (?<value>-?[\d.]+)f$/u.exec(text.trim())?.groups?.["value"];
  if (value === undefined) {
    context.addIssue({ code: "custom", message: `no health in ${text}` });
    return z.NEVER;
  }
  return Number(value);
});

async function health(rcon: RconClient, bot: Bot): Promise<number> {
  return HealthSchema.parse(
    await rcon.command(`data get entity ${bot.username} Health`),
  );
}

async function teamOf(log: Transcript): Promise<Team> {
  const seen = await log.until(/You are in (?<team>Red|Blue) Team\./u, 30_000);
  return z.enum(["Red", "Blue"]).parse(seen.groups?.["team"]);
}

const joinedPattern = /^\[RWF\]: (?<name>\w+) joined the match\.$/u;

/** The bots that joined this countdown, from the human's transcript. */
async function joinedBots(
  log: Transcript,
  human: string,
  count: number,
): Promise<string[]> {
  await eventually(
    `${count.toString()} bots to join`,
    async () => log.all(joinedPattern).length >= count + 1,
  );
  return log
    .all(joinedPattern)
    .map((match) => match.groups?.["name"] ?? "")
    .filter((name) => name !== human);
}

async function liveStatus(rcon: RconClient) {
  const now = await status(rcon);
  return now.phase === "Live";
}

/** One lone-human match and what the human's client saw of it. */
type Match = {
  bot: Bot;
  rcon: RconClient;
  server: ServerInfo;
  catalog: Map<string, Personality>;
  log: Transcript;
  view: ClientView;
  /** The owned targetCombatants. */
  target: number;
};

/** (a) The countdown fills the match with shipped personalities. */
async function fillsWithBots(match: Match): Promise<string[]> {
  const { bot, rcon, log, view, catalog } = match;
  const wanted = match.target - 1;
  const listBefore = ListOutputSchema.parse(await rcon.command("list"));
  bot.chat("/rwf join");
  await log.until(/The game will begin in \d+ seconds\./u);
  const names = await joinedBots(log, bot.username, wanted);
  expect(names).toHaveLength(wanted);
  expect(new Set(names).size).toBe(wanted);
  for (const name of names) {
    expect(catalog.has(name), `${name} is a shipped personality`).toBe(true);
  }
  const counting = await status(rcon);
  expect(counting.phase).toBe("Countdown");
  expect([counting.humans, counting.bots]).toEqual([1, wanted]);
  expect(counting.roster).toBe("present");

  // Player NPCs, not players: nothing joins the online list or its count.
  const listDuring = ListOutputSchema.parse(await rcon.command("list"));
  expect([listDuring.online, listDuring.max]).toEqual([
    listBefore.online,
    listBefore.max,
  ]);
  for (const name of names) {
    expect(listDuring.names).not.toContain(name);
  }

  // Each body carries its personality's signed skin, straight from its file.
  await eventually("every bot's profile", async () =>
    names.every((name) => view.profiles.get(name)?.textures !== undefined),
  );
  for (const name of names) {
    const textures = view.profiles.get(name)?.textures;
    const skin = catalog.get(name)?.skin;
    expect(textures?.value, `${name}'s skin`).toBe(skin?.value);
    expect(textures?.signature, `${name}'s skin signature`).toBe(
      skin?.signature,
    );
  }
  return names;
}

/** The match goes live and every bot wears rwf's dim marker. */
async function goesLiveMarked(match: Match, names: string[]) {
  const { bot, rcon, log, view } = match;
  await log.until(/The game has begun!/u, 30_000);
  const team = await teamOf(log);
  const live = await status(rcon);
  expect(live.phase).toBe("Live");
  expect(live.map).toBe("training-yard");
  expect([live.humans, live.bots]).toEqual([1, names.length]);

  await eventually("every bot on a bot team", async () =>
    names.every((name) => view.botTeam(name) !== undefined),
  );
  for (const color of ["red", "blue"]) {
    expect(view.suffixes.get(`rwf_${color}_bot`)).toContain("✦");
    expect(view.suffixes.get(`rwf_${color}`) ?? "").not.toContain("✦");
  }
  expect(view.teams.get(bot.username)).toBe(`rwf_${team.toLowerCase()}`);
  const who = plain(await rcon.command("rwf who"));
  for (const name of names) {
    expect(who).toMatch(new RegExp(`${escaped(name)} ✦`, "u"));
  }
  expect(who).not.toMatch(new RegExp(`${escaped(bot.username)} ✦`, "u"));
  return { team, matchId: live.matchId };
}

/** (b) Bots on both teams leave their spawns. */
async function leaveSpawns(view: ClientView, names: string[]): Promise<void> {
  await Bun.sleep(1000);
  const spawns = new Map<string, Vec3>();
  for (const name of names) {
    const at = view.entity(name)?.position;
    if (at !== undefined) {
      spawns.set(name, at.clone());
    }
  }
  const moved = new Set<Team | undefined>();
  await eventually(
    "bots on both teams to leave their spawns",
    async () => {
      for (const [name, spawn] of spawns) {
        const at = view.entity(name)?.position;
        if (at !== undefined && at.distanceTo(spawn) > 4) {
          moved.add(view.botTeam(name));
        }
      }
      return moved.has("Red") && moved.has("Blue");
    },
    30_000,
  );
}

/** (d) Under this light load the governor stays at level 0. */
async function thinkAtLevelZero(
  rcon: RconClient,
  names: string[],
  maxDecisionAgeTicks: number,
): Promise<void> {
  await eventually("the think loop to run", async () => {
    const now = await debug(rcon);
    return now.jobs > 0;
  });
  const overview = await debug(rcon);
  expect(overview.level).toBe(0);
  expect(overview.stalenessP95).toBeLessThanOrEqual(maxDecisionAgeTicks);
  for (const name of names) {
    expect(overview.text).toMatch(
      new RegExp(String.raw`${escaped(name)} \[(?:red|blue), \w+\] plan `, "u"),
    );
  }
}

/**
 * Stands the human a block from the nearest living enemy bot, again and
 * again, until a bot's sword or arrow lowers their health or they die.
 */
async function offerHits(match: Match, enemies: string[]): Promise<void> {
  const { rcon, bot: human, view } = match;
  await eventually(
    "an enemy bot to hit the human",
    async () => {
      if (
        human.game.gameMode !== "survival" ||
        (await health(rcon, human)) < 20
      ) {
        return true;
      }
      const [target] = enemies
        .map((name) => view.entity(name))
        .filter((entity) => entity !== undefined)
        .toSorted(
          (a, b) =>
            a.position.distanceTo(human.entity.position) -
            b.position.distanceTo(human.entity.position),
        );
      if (target !== undefined) {
        const at = target.position.offset(1, 0, 0);
        await rcon.command(
          `execute in ${dimension} run tp ${human.username} ${at.x.toString()} ${at.y.toString()} ${at.z.toString()}`,
        );
      }
      await Bun.sleep(1500);
      return false;
    },
    90_000,
  );
}

/** Only the human is paid, scaled by the human share of the roster. */
async function paysOnlyTheHuman(
  match: Match,
  matchId: string,
  outcome: { team: Team; winner: Team },
) {
  const settled = await settledMatch(match.server, matchId);
  expect(settled.match.winner).toBe(outcome.winner.toUpperCase());
  expect([settled.match.humans, settled.match.bots]).toEqual([
    1,
    match.target - 1,
  ]);
  expect(settled.players).toHaveLength(1);
  const [times] = MatchTimesSchema.parse(
    await querySqlite(
      settled.database,
      `SELECT started_at, ended_at FROM rwf_match WHERE id = '${matchId}'`,
    ),
  );
  const lasted = (times?.ended_at ?? 0) - (times?.started_at ?? 0);
  const won = outcome.winner === outcome.team;
  const share = 0.25 + 0.75 * (1 / match.target);
  const owed = lasted >= 60_000 ? Math.round((won ? 3 : 1) * share) : 0;
  const [row] = settled.players;
  expect(row?.result).toBe(won ? "WIN" : "LOSE");
  expect(row?.credits_owed).toBe(owed);
  expect(row?.payout_status).toBe(owed > 0 ? "PAID" : "NONE");
  expect(row?.credits_paid).toBe(owed);
  return { settled, owed };
}

/** Bots' swings went through the rules and bots tried to arm a bomb. */
function expectPlayed(recording: Recording, view: ClientView): void {
  const humans = [...recording.roster.values()].filter((entry) => !entry.bot);
  expect(humans).toHaveLength(1);
  // An attack intent is written only for a swing that passed reach, line of
  // sight and the hit window, and went through the rules' damage.
  const swings = recording.intents.filter(
    (intent) =>
      intent.kind === "attack" &&
      recording.roster.get(intent.pseudonym)?.bot === true,
  );
  expect(swings.length, "bots swung at combatants").toBeGreaterThan(0);
  expect(swings.every((swing) => recording.roster.has(swing.target))).toBe(
    true,
  );
  expect(view.hurt.size, "the client saw bots hurt").toBeGreaterThan(0);
  const armingClicks = recording.intents.filter((intent) => {
    const clicker = recording.roster.get(intent.pseudonym);
    return (
      intent.kind === "bomb" &&
      clicker?.bot === true &&
      !intent.target.startsWith(`${clicker.team.toLowerCase()}-`)
    );
  });
  expect(
    armingClicks.length,
    "bots clicked a bomb that is not their team's",
  ).toBeGreaterThan(0);
}

/** Each drafted personality's record gains one match and its team's result. */
async function ratedOnce(
  match: Match,
  names: string[],
  before: Map<string, StatsRow>,
  result: { matchId: string; winner: Team },
) {
  await eventually("the personality records", async () => {
    const logs = await serverLogs(match.server);
    return logs.includes(
      `rwfbots: rated ${names.length.toString()} personalities after match ${result.matchId}`,
    );
  });
  const after = await personalityStats(match.server, result.matchId);
  return names.map((name) => {
    const id = match.catalog.get(name)?.id ?? "";
    const was = before.get(id);
    const now = after.get(id);
    expect(now, `${name} has a record`).toBeDefined();
    expect((now?.matches ?? 0) - (was?.matches ?? 0)).toBe(1);
    expect((now?.wins ?? 0) - (was?.wins ?? 0)).toBe(
      match.view.botTeam(name) === result.winner ? 1 : 0,
    );
    return { name, deaths: (now?.deaths ?? 0) - (was?.deaths ?? 0) };
  });
}

/** After the end screen every bot is gone and the human holds their pay. */
async function allGone(match: Match, names: string[], owed: number) {
  const { rcon, bot, view } = match;
  await waitForLobby(rcon);
  const lobby = await status(rcon);
  expect(lobby.bots).toBe(0);
  const overview = await debug(rcon);
  expect(overview.text).toContain("no bots in the match");
  await eventually("the bot bodies to vanish", async () =>
    names.every((name) => view.entity(name) === undefined),
  );
  await eventually(
    "the human's payout",
    async () => (await balance(bot)) === startingBalance + owed,
    20_000,
  );
}

/** One life per match: each death recorded and rated once, killers named. */
function eachDeathOnce(
  recording: Recording,
  deltas: { name: string; deaths: number }[],
): void {
  const deaths = recording.events.filter((event) => event[0] === "died");
  const victims = deaths.map((event) => event[1]);
  expect(new Set(victims).size, "each death is recorded once").toBe(
    victims.length,
  );
  expect(
    deaths.some((event) => event[2]?.startsWith("p") === true),
    "a combat death names its killer",
  ).toBe(true);
  for (const { name, deaths: died } of deltas) {
    expect(died, `${name} died at most once`).toBeLessThanOrEqual(1);
  }
}

/**
 * A bots-only match outlives the no-humans abort, ends with a winner, pays
 * nobody, records only bots and rates every personality that played.
 */
async function showcaseSettles(
  server: ServerInfo,
  matchId: string,
  size: number,
  statsBefore: Awaited<ReturnType<typeof personalityStats>>,
): Promise<void> {
  await eventually(
    "the showcase to end and its recording to close",
    async () => {
      const rows = await matchRows(server, matchId);
      return (rows.match?.recording_file ?? null) !== null;
    },
    matchBudgetMs,
  );
  const settled = await matchRows(server, matchId);
  expect(settled.match?.winner).toMatch(/^(?:RED|BLUE)$/u);
  expect([settled.match?.humans, settled.match?.bots]).toEqual([0, size]);
  expect(settled.players).toEqual([]);
  const recording = readRecording(
    await gzipLines(
      server,
      settled.match?.recording_file ?? "",
      settled.outDir,
    ),
  );
  expect(recording.roster.size).toBe(size);
  expect([...recording.roster.values()].every((entry) => entry.bot)).toBe(true);
  await eventually("the showcase's personality records", async () => {
    const logs = await serverLogs(server);
    return logs.includes(
      `rwfbots: rated ${size.toString()} personalities after match ${matchId}`,
    );
  });
  const statsAfter = await personalityStats(server, matchId);
  const rated = [...statsAfter].filter(
    ([id, row]) => row.matches > (statsBefore.get(id)?.matches ?? 0),
  );
  expect(rated).toHaveLength(size);
}

async function newMatch(
  bot: Bot,
  rcon: RconClient,
  server: ServerInfo,
): Promise<Match> {
  await waitForLobby(rcon);
  const { match } = await ownedYaml("rwf.yml", OwnedRwfSchema);
  return {
    bot,
    rcon,
    server,
    catalog: await personalities(),
    log: transcript(bot),
    view: clientView(bot),
    target: match.targetCombatants,
  };
}

describe("Search and Destroy with rwfbots", () => {
  test(
    "bots fill a lone human's match, play it to a result, are rated and only the human is paid",
    { timeout: 16 * 60_000 },
    async ({ bot, rcon, server }) => {
      const match = await newMatch(bot, rcon, server);
      const { think } = await ownedYaml("rwfbots.yml", OwnedBotsSchema);
      // With Citizens present the module enables over every shipped persona
      // and the training yard's nav artifact.
      expect(await serverLogs(server)).toContain(
        `rwfbots: ${match.catalog.size.toString()} personalities, 1 maps with nav artifacts, traces on`,
      );
      expect(await balance(bot)).toBe(startingBalance);
      const statsBefore = await personalityStats(server, "stats-before");

      const names = await fillsWithBots(match);
      const { team, matchId } = await goesLiveMarked(match, names);
      await leaveSpawns(match.view, names);
      await thinkAtLevelZero(rcon, names, think.maxDecisionAgeTicks);
      await offerHits(
        match,
        names.filter((name) => match.view.botTeam(name) !== team),
      );

      // The match plays out to a result; bots are free to win, lose or nuke.
      const ended = await match.log.until(
        /^\[RWF\]: (?<team>Red|Blue) Team wins!$/u,
        matchBudgetMs,
      );
      const winner = z.enum(["Red", "Blue"]).parse(ended.groups?.["team"]);
      const after = await debug(rcon);
      expect(after.level).toBe(0);

      const { settled, owed } = await paysOnlyTheHuman(match, matchId, {
        team,
        winner,
      });
      const recording = readRecording(
        await gzipLines(
          server,
          settled.match.recording_file ?? "",
          settled.outDir,
        ),
      );
      expectPlayed(recording, match.view);
      const recorded = recording.events.flat().join(" ");
      for (const name of [bot.username, ...names]) {
        expect(recorded).not.toContain(name);
      }
      const deltas = await ratedOnce(match, names, statsBefore, {
        matchId,
        winner,
      });
      const traces = await gzipLines(
        server,
        `rwfbots-traces/${matchId}.gz`,
        settled.outDir,
      );
      expect(traces.length).toBeGreaterThan(0);
      expect(traces.every((line) => line.startsWith("decision\t"))).toBe(true);
      await allGone(match, names, owed);
      eachDeathOnce(recording, deltas);
    },
  );

  test(
    "a watcher follows a bots-only showcase to its result, nobody is paid and leaving restores them",
    { timeout: 16 * 60_000 },
    async ({ bot, rcon, server }) => {
      const match = await newMatch(bot, rcon, server);
      const size = 8;
      await rcon.command(`give ${bot.username} minecraft:diamond 3`);
      await eventually("the diamonds", async () => diamonds(bot) === 3);
      const home = bot.entity.position.clone();
      const statsBefore = await personalityStats(server, "showcase-before");

      bot.chat("/rwf spectate");
      await match.log.until(/You are watching Search and Destroy\./u);
      await eventually(
        "the watcher in spectator mode",
        async () => bot.game.gameMode === "spectator",
      );
      const started = plain(
        await rcon.command(`rwf admin showcase ${size.toString()}`),
      );
      expect(started).toContain(`Showcase of ${size.toString()} bots started`);
      await eventually(
        "the showcase to go live",
        async () => liveStatus(rcon),
        30_000,
      );
      const live = await status(rcon);
      expect([live.humans, live.bots]).toEqual([0, size]);
      expect(plain(await rcon.command("rwf admin status"))).toContain(
        "Watchers: 1, showcase: yes",
      );

      // The watcher follows a living bot.
      bot.chat("/rwf spectate next");
      const followed = await match.log.until(/Following (?<name>\w+)\./u);
      expect(match.catalog.has(followed.groups?.["name"] ?? "")).toBe(true);

      await showcaseSettles(server, live.matchId, size, statsBefore);

      // The watcher stays through the reset; the next lobby waits for a human.
      await waitForLobby(rcon);
      const next = await status(rcon);
      expect(next.bots).toBe(0);
      expect(plain(await rcon.command("rwf admin status"))).toContain(
        "Watchers: 1, showcase: no",
      );
      expect(bot.game.gameMode).toBe("spectator");
      expect(match.log.has(/You earned/u)).toBe(false);
      expect(await balance(bot)).toBe(startingBalance);

      bot.chat("/rwf leave");
      await eventually(
        "the watcher restored",
        async () =>
          bot.game.gameMode === "survival" &&
          diamonds(bot) === 3 &&
          bot.entity.position.distanceTo(home) < 1,
        20_000,
      );
      expect(plain(await rcon.command("rwf admin status"))).toContain(
        "Watchers: 0",
      );
    },
  );

  test(
    "the last human leaving a live match stops it unpaid and despawns every bot",
    { timeout: 120_000 },
    async ({ rcon, server }) => {
      await waitForLobby(rcon);
      const catalog = await personalities();
      const { match: settings } = await ownedYaml("rwf.yml", OwnedRwfSchema);
      const wanted = settings.targetCombatants - 1;
      const username = `c_${Date.now().toString(36).slice(-6)}`;
      const connect = async () =>
        connectBot({ host: server.host, port: server.gamePort, username });
      let human: Bot | undefined = await connect();
      try {
        const log = transcript(human);
        const statsBefore = await personalityStats(server, "abort-before");
        human.chat("/rwf join");
        const names = await joinedBots(log, username, wanted);
        await log.until(/The game has begun!/u, 30_000);
        const live = await status(rcon);
        expect(live.phase).toBe("Live");
        expect([live.humans, live.bots]).toEqual([1, wanted]);

        // The human disconnects: within noHumansAbort the match stops.
        await disconnectBot(human);
        human = undefined;
        const left = Date.now();
        await eventually(
          "the match to stop",
          async () => {
            const logs = await serverLogs(server);
            return logs.includes(`rwf match ${live.matchId} stopped by Stop`);
          },
          20_000,
        );
        expect(await serverLogs(server)).toContain(
          `rwf match ${live.matchId} has had no humans for ${rwfTestSettings.noHumansAbort}; stopping`,
        );
        // The abort waits noHumansAbort (5 s) plus the tick that notices.
        expect(Date.now() - left).toBeLessThan(15_000);
        await waitForLobby(rcon);
        const lobby = await status(rcon);
        expect(lobby.bots).toBe(0);
        const overview = await debug(rcon);
        expect(overview.text).toContain("no bots in the match");

        // Unpaid and unrated.
        const settled = await settledMatch(server, live.matchId);
        expect(settled.match.winner).toBeNull();
        expect([settled.match.humans, settled.match.bots]).toEqual([1, wanted]);
        expect(
          settled.players.map((row) => [
            row.result,
            row.credits_owed,
            row.payout_status,
          ]),
        ).toEqual([["STOPPED", 0, "NONE"]]);
        const statsAfter = await personalityStats(server, live.matchId);
        for (const name of names) {
          const id = catalog.get(name)?.id ?? "";
          expect(statsAfter.get(id)?.matches).toBe(
            statsBefore.get(id)?.matches,
          );
        }
        human = await connect();
        expect(await balance(human)).toBe(startingBalance);
      } finally {
        if (human !== undefined) {
          await disconnectBot(human);
        }
      }
    },
  );
});
