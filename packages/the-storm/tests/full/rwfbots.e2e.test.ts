import path from "node:path";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";
import { setRwfFeatures } from "#e2e/harness/fake-brain.ts";
import { ListOutputSchema } from "#e2e/harness/rcon-output.ts";
import {
  box,
  lobby as authoredLobby,
  lobbyDimension,
} from "#e2e/harness/rwf-humans.ts";
import {
  eventually,
  matchRows,
  settledMatch,
  status,
  transcript,
  type Transcript,
  waitForLobby,
} from "#e2e/harness/rwf-match.ts";
import {
  fullRwfTestSettings,
  rwfTestSettings,
} from "#e2e/harness/rwf-settings.ts";
import {
  type ClientView,
  clientView,
  debug,
  diamonds,
  escaped,
  expectSampleCadence,
  expectCredits,
  gzipLines,
  lookAround,
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
import {
  advance,
  dispersion,
  readTrails,
  type Trails,
} from "#e2e/harness/rwf-trails.ts";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { querySqlite } from "#e2e/harness/storm-data.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { packageRoot } from "#e2e/harness/paths.ts";

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
/** How long a bots' match may take: the poison ends a quiet one after 10 min. */
const matchBudgetMs = 14 * 60_000;

const OwnedRwfSchema = z.object({
  match: z.object({ targetCombatants: z.number().int().positive() }),
});
const CountdownMillisSchema = z.iso
  .duration()
  .transform((value) => Temporal.Duration.from(value).total("milliseconds"))
  .pipe(z.number().positive());
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
  const seen = await log.until(/You are in (?<team>Red|Blue) Team/u, 30_000);
  return z.enum(["Red", "Blue"]).parse(seen.groups?.["team"]);
}

const joinedPattern = /^\[RWF\]: (?<name>\w+) joined the match\.$/u;

/** The bots that joined this countdown, from the human's transcript. */
async function joinedBots(
  rcon: RconClient,
  log: Transcript,
  human: string,
  count: number,
): Promise<string[]> {
  // Bots now walk in over the countdown. Observe that lifecycle rather than
  // racing its last arrival against an unrelated fifteen-second deadline.
  try {
    await eventually(
      `${count.toString()} bots to join`,
      async () => log.all(joinedPattern).length >= count + 1,
      CountdownMillisSchema.parse(fullRwfTestSettings.countdown),
    );
  } catch (error) {
    throw new Error(
      `Expected ${count.toString()} bots and ${human} to join; saw:\n${log.lines.join("\n")}`,
      { cause: error },
    );
  }
  expect(log.has(/The game has begun!/u), "all bots arrive in the lobby").toBe(
    false,
  );
  const current = await status(rcon);
  expect(
    current.phase,
    "every drafted bot joins before the match goes live",
  ).toBe("Countdown");
  return log
    .all(joinedPattern)
    .map((match) => match.groups?.["name"] ?? "")
    .filter((name) => name !== human);
}

async function liveStatus(rcon: RconClient) {
  const now = await status(rcon);
  return now.phase === "Live";
}

async function startShowcase(rcon: RconClient, size: number) {
  const started = plain(
    await rcon.command(`rwf admin showcase ${size.toString()}`),
  );
  expect(started).toContain(
    `Showcase of ${size.toString()} bots is starting after map preparation`,
  );
  await eventually(
    "the showcase to go live",
    async () => liveStatus(rcon),
    30_000,
  );
  const live = await status(rcon);
  expect([live.humans, live.bots]).toEqual([0, size]);
  return live;
}

/** Every accepted start is cleaned up, including a failure before it reaches Live. */
async function usingShowcase(
  rcon: RconClient,
  size: number,
  play: (live: Awaited<ReturnType<typeof status>>) => Promise<void>,
  start: () => Promise<Awaited<ReturnType<typeof status>>> = () =>
    startShowcase(rcon, size),
): Promise<void> {
  const owned = await status(rcon);
  expect(owned.ready).toBe(true);
  expect([owned.phase, owned.humans, owned.bots]).toEqual(["Lobby", 0, 0]);
  try {
    const live = await start();
    expect(live.matchId).toBe(owned.matchId);
    await play(live);
  } finally {
    const current = await status(rcon);
    // A naturally completed showcase may already have opened the next match.
    if (current.matchId === owned.matchId) {
      await rcon.command("rwf admin forcestop");
      await waitForLobby(rcon);
    }
  }
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
  await log.until(/The game will begin in /u);
  const names = await joinedBots(rcon, log, bot.username, wanted);
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

/** The lobby room (rwf/lobby/lobby.yml), both corners' blocks included. */
const lobbyRoom = authoredLobby.region;

function inLobby(at: Vec3): boolean {
  return (
    at.x >= lobbyRoom.min.x &&
    at.x < lobbyRoom.max.x + 1 &&
    at.y >= lobbyRoom.min.y &&
    at.y < lobbyRoom.max.y + 1 &&
    at.z >= lobbyRoom.min.z &&
    at.z < lobbyRoom.max.z + 1
  );
}

/** What the human's client and `/rwf who` showed of the bots during the countdown. */
type LobbySample = { at: Vec3; inLobbyWorld: boolean };

type LobbyWatch = {
  /** Every kit `/rwf who` listed for each bot, in the order seen. */
  kits: Map<string, string[]>;
  /** Where the human's client saw each bot, sample by sample. */
  positions: Map<string, LobbySample[]>;
  /** Bots the human's client saw crouch. */
  crouched: Set<string>;
  /** Stops sampling. */
  stop: () => Promise<void>;
};

async function sampleLobby(match: Match): Promise<[string, LobbySample][]> {
  const before = await status(match.rcon);
  if (!["Lobby", "Countdown"].includes(before.phase)) return [];
  const observed: [string, LobbySample][] = [];
  for (const seen of Object.values(match.bot.entities)) {
    const name = seen.username;
    if (name === undefined || name === match.bot.username) continue;
    const at = seen.position.clone();
    const reply = await match.rcon.command(
      `execute in ${lobbyDimension} if entity @e[name=${name},${box(lobbyRoom)}]`,
    );
    observed.push([name, { at, inLobbyWorld: reply.includes("Test passed") }]);
  }
  // Discard only a sample straddling the legitimate transition out of the lobby.
  const after = await status(match.rcon);
  return ["Lobby", "Countdown"].includes(after.phase) ? observed : [];
}

/** Samples the lobby twice a second from before the human joins until the match goes live. */
function watchLobby(match: Match): LobbyWatch {
  const { bot, rcon } = match;
  let running = true;
  let sampler: Promise<void> = Promise.resolve();
  const watch: LobbyWatch = {
    kits: new Map(),
    positions: new Map(),
    crouched: new Set(),
    stop: async () => {
      running = false;
      await sampler;
    },
  };
  bot.on("entityCrouch", (entity) => {
    if (entity.username !== undefined && entity.username !== bot.username) {
      watch.crouched.add(entity.username);
    }
  });
  sampler = (async () => {
    while (running && !match.log.has(/The game has begun!/u)) {
      const who = plain(await rcon.command("rwf who"));
      for (const seen of who.matchAll(/(?<name>\w+) ✦ \[(?<kit>[a-z-]+)\]/gu)) {
        const name = seen.groups?.["name"] ?? "";
        const kit = seen.groups?.["kit"] ?? "";
        const kits = watch.kits.get(name) ?? [];
        if (kits.at(-1) !== kit) {
          kits.push(kit);
        }
        watch.kits.set(name, kits);
      }
      for (const [name, sample] of await sampleLobby(match)) {
        const samples = watch.positions.get(name) ?? [];
        samples.push(sample);
        watch.positions.set(name, samples);
      }
      await Bun.sleep(500);
    }
  })();
  return watch;
}

/**
 * (a2) During the countdown the bots stay in the lobby room, move about it, at
 * least one taps sneak at someone, and at least one changes kit through the
 * same pick path `/rwf kit` uses before settling on its drafted kit.
 */
async function liveInTheLobby(
  match: Match,
  watch: LobbyWatch,
  names: string[],
): Promise<void> {
  await match.log.until(/The game has begun!/u, 60_000);
  await watch.stop();
  await Bun.write(
    path.join(packageRoot, ".cache", "e2e", "full", "lobby-samples.json"),
    JSON.stringify(
      {
        world: lobbyDimension,
        region: lobbyRoom,
        positions: Object.fromEntries(watch.positions),
      },
      null,
      2,
    ),
  );
  expect(
    names.filter((name) => (watch.positions.get(name)?.length ?? 0) > 0),
    "the human's client sees the bots in the lobby",
  ).not.toHaveLength(0);
  for (const name of names) {
    const samples = watch.positions.get(name) ?? [];
    for (const { at, inLobbyWorld } of samples) {
      expect(
        inLobbyWorld,
        `${name} is inside ${lobbyDimension}'s lobby region`,
      ).toBe(true);
      expect(inLobby(at), `${name} at ${at.toString()} is in the lobby`).toBe(
        true,
      );
    }
  }
  const travelled = names.map((name) => {
    const samples = watch.positions.get(name) ?? [];
    const first = samples[0];
    return first === undefined
      ? 0
      : Math.max(0, ...samples.map(({ at }) => at.distanceTo(first.at)));
  });
  expect(
    Math.max(...travelled),
    "some bot moves about the lobby",
  ).toBeGreaterThan(1);
  expect(watch.crouched.size, "some bot taps sneak").toBeGreaterThan(0);
  const switched = [...watch.kits.values()].filter((kits) => kits.length > 1);
  expect(switched.length, "some bot changes kit in the lobby").toBeGreaterThan(
    0,
  );
}

/** The match goes live and every bot wears rwf's dim marker. */
async function goesLiveMarked(match: Match, names: string[]) {
  const { bot, rcon, log, view } = match;
  await log.until(/The game has begun!/u, 30_000);
  const team = await teamOf(log);
  await lookAround(bot);
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
          `execute in ${dimension} run minecraft:tp ${human.username} ${at.x.toString()} ${at.y.toString()} ${at.z.toString()}`,
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
  await expectCredits(bot, owed);
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

/** An entity selector for a bot's Citizens player body. */
function body(name: string): string {
  return `@e[name=${name},limit=1]`;
}

const AbsorptionSchema = z.string().transform((text, context) => {
  const value = /: (?<value>-?[\d.]+)f$/u.exec(text.trim())?.groups?.["value"];
  if (value === undefined) {
    context.addIssue({ code: "custom", message: `no absorption in ${text}` });
    return z.NEVER;
  }
  return Number(value);
});

/** Quirks that change when, or whether, a bot eats a golden apple. */
const pickyEaters = new Set(["never_eats", "gapple_hoarder"]);

/** A live match found by {@link liveWithEater}, and the human playing it. */
type EaterMatch = {
  human: Bot;
  names: string[];
  eaters: string[];
  matchId: string;
};

/** The bots in the live match that carry golden apples and eat normally. */
async function eatersIn(
  rcon: RconClient,
  catalog: Map<string, Personality>,
  names: string[],
): Promise<string[]> {
  const eaters: string[] = [];
  for (const name of names) {
    // The whole inventory overflows one RCON reply; ask for the apple alone.
    const apples = await rcon.command(
      `execute if data entity ${body(name)} Inventory[{id:"minecraft:golden_apple"}]`,
    );
    const quirks = catalog.get(name)?.quirks ?? [];
    if (
      apples.includes("Test passed") &&
      !quirks.some((quirk) => pickyEaters.has(quirk))
    ) {
      eaters.push(name);
    }
  }
  return eaters;
}

/**
 * A lone human's live match with a bot that carries golden apples (a Trooper)
 * and eats normally. Kits are the drafted personalities' own choice, so a
 * draft without one is abandoned: that human disconnects (the match stops)
 * and a fresh one, with no restore to confirm, tries a new draft.
 */
async function liveWithEater(
  rcon: RconClient,
  server: ServerInfo,
  catalog: Map<string, Personality>,
  target: number,
): Promise<EaterMatch> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await waitForLobby(rcon);
    const human = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: `e_${Date.now().toString(36).slice(-6)}`,
    });
    let retained = false;
    try {
      const log = transcript(human);
      human.chat("/rwf join");
      const names = await joinedBots(rcon, log, human.username, target - 1);
      await log.until(/The game has begun!/u, 30_000);
      const live = await status(rcon);
      expect(live.phase).toBe("Live");
      const eaters = await eatersIn(rcon, catalog, names);
      if (eaters.length > 0) {
        retained = true;
        return { human, names, eaters, matchId: live.matchId };
      }
    } finally {
      if (!retained) {
        await disconnectBot(human);
      }
    }
  }
  throw new Error("four drafts in a row had no Trooper that eats");
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

/** The showcase case, with a player outside the rwf world listening. */
async function watchShowcase(match: Match, outsider: Bot): Promise<void> {
  const { bot, rcon, server } = match;
  const outside = transcript(outsider);
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
  await usingShowcase(rcon, size, async (live) => {
    expect(plain(await rcon.command("rwf admin status"))).toContain(
      "Watchers: 1, showcase: yes",
    );

    // The watcher follows a living bot.
    bot.chat("/rwf spectate next");
    const followed = await match.log.until(/Following (?<name>\w+)\./u);
    expect(match.catalog.has(followed.groups?.["name"] ?? "")).toBe(true);

    await showcaseSettles(server, live.matchId, size, statsBefore);

    // Bot chat (the-storm-rwfbots-chat-enabled is on in the fake Flipt):
    // the watcher in the rwf world hears ✦-marked Global lines from the
    // showcase's bots, with a team mark once teams exist; team calls stay with
    // the bots' teams; the player in the main world hears none of them.
    const botLines = match.log.all(/^\[G\]\[(?:● )?(?<name>\w+) ✦\]: .+$/u);
    expect(botLines.length).toBeGreaterThan(0);
    expect(
      botLines.every((line) => match.catalog.has(line.groups?.["name"] ?? "")),
    ).toBe(true);
    expect(outside.has(/✦/u)).toBe(false);

    // The watcher stays through the reset; the next lobby waits for a human.
    await waitForLobby(rcon);
    const next = await status(rcon);
    expect(next.bots).toBe(0);
    expect(plain(await rcon.command("rwf admin status"))).toContain(
      "Watchers: 1, showcase: no",
    );
    expect(bot.game.gameMode).toBe("spectator");
    expect(match.log.has(/Given \d+ credit/u)).toBe(false);
    await expectCredits(bot, 0);

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
  });
}

describe("Search and Destroy with rwfbots", () => {
  test(
    "bots fill a lone human's match, play it to a result, are rated and only the human is paid",
    { timeout: 16 * 60_000 },
    async ({ bot, rcon, server }) => {
      const match = await newMatch(bot, rcon, server);
      const { think } = await ownedYaml("rwfbots.yml", OwnedBotsSchema);
      // With Citizens present the module enables every shipped persona and
      // loads navigation when the runner prepares a map.
      expect(await serverLogs(server)).toContain(
        `rwfbots: ${match.catalog.size.toString()} personalities, navigation follows prepared maps, traces on`,
      );
      await expectCredits(bot, 0);
      const statsBefore = await personalityStats(server, "stats-before");

      const lobby = watchLobby(match);
      const names = await fillsWithBots(match);
      await liveInTheLobby(match, lobby, names);
      const { team, matchId } = await goesLiveMarked(match, names);
      await leaveSpawns(match.view, names);
      await thinkAtLevelZero(rcon, names, think.maxDecisionAgeTicks);
      const learning = plain(await rcon.command("rwfbots debug learning"));
      expect(learning).toContain("learning OFF; applied 0");
      expect(learning).toContain("flag outages 0; model load rejects 0");
      expect(learning).not.toContain("inference submitted");
      await offerHits(
        match,
        names.filter((name) => match.view.botTeam(name) !== team),
      );

      // The match plays out to a result; bots are free to win, lose or nuke.
      const ended = await match.log.until(
        /^(?<team>Red|Blue) Team wins!$/u,
        matchBudgetMs,
      );
      const winner = z.enum(["Red", "Blue"]).parse(ended.groups?.["team"]);
      const after = await debug(rcon);
      expect(after.level).toBe(0);

      const { settled, owed } = await paysOnlyTheHuman(match, matchId, {
        team,
        winner,
      });
      await Bun.write(
        path.join(settled.outDir, "learning.txt"),
        learning + "\n",
      );
      const recording = readRecording(
        await gzipLines(
          server,
          settled.match.recording_file ?? "",
          settled.outDir,
        ),
      );
      expectPlayed(recording, match.view);
      expectSampleCadence(recording);
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
    "a watcher follows a bots-only showcase to its result, hears the bots talk, nobody is paid and leaving restores them",
    { timeout: 16 * 60_000 },
    async ({ bot, rcon, server }) => {
      const match = await newMatch(bot, rcon, server);
      // A player who stays in the main world while the bots talk.
      const outsider = await connectBot({
        host: server.host,
        port: server.gamePort,
        username: `o_${Date.now().toString(36).slice(-6)}`,
      });
      try {
        await watchShowcase(match, outsider);
      } finally {
        await disconnectBot(outsider);
      }
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
        const names = await joinedBots(rcon, log, username, wanted);
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
        await expectCredits(human, 0);
      } finally {
        if (human !== undefined) {
          await disconnectBot(human);
        }
      }
    },
  );
});

describe("rwfbots bodies and reflexes", () => {
  test(
    "human sword hits damage fresh bot bodies after lobby and repeated world transfers",
    { timeout: 120_000 },
    async ({ bot, rcon, server, brain }) => {
      const previousFeatures = await setRwfFeatures(brain.port, [
        "the-storm-rwf-match-flow-enabled",
      ]);
      let matchId: string | undefined;
      try {
        await rcon.command("rwf admin forcestop");
        await waitForLobby(rcon);
        expect(await rcon.command("rwf admin status")).toContain(
          "matchFlow=true",
        );
        const match = await newMatch(bot, rcon, server);
        const names = await fillsWithBots(match);
        // Lobby kit plans may change an earlier choice. In Freeze regular picks stop,
        // while the operator can still equip both sides before genuine combat begins.
        await eventually(
          "the kit assignment Freeze",
          async () => {
            const current = await status(rcon);
            return current.phase === "Freeze";
          },
          30_000,
        );
        for (const name of [bot.username, ...names]) {
          expect(
            plain(await rcon.command(`rwf admin forcekit ${name} trooper`)),
          ).toContain(`${name} now uses trooper.`);
        }
        const live = await goesLiveMarked(match, names);
        matchId = live.matchId;
        const victim = names.find(
          (name) => match.view.botTeam(name) !== live.team,
        );
        if (victim === undefined) {
          throw new Error("the live match has no enemy bot");
        }
        // A rejected Live command must never masquerade as successful setup again.
        expect(
          plain(await rcon.command(`rwf admin forcekit ${victim} rewind`)),
        ).toContain("You can only do that before the match starts.");
        const liveRoster = plain(await rcon.command("rwf who"));
        expect(liveRoster).toContain(`${bot.username} [trooper]`);
        for (const name of names) {
          expect(liveRoster).toContain(`${name} ✦ [trooper]`);
        }
        for (const [slot, material] of [
          ["head", "iron_helmet"],
          ["chest", "iron_chestplate"],
          ["legs", "iron_leggings"],
          ["feet", "iron_boots"],
        ] as const) {
          expect(
            await rcon.command(
              `data get entity ${body(victim)} equipment.${slot}.id`,
            ),
          ).toContain(`"minecraft:${material}"`);
        }
        expect(
          await rcon.command(`data get entity ${body(victim)} equipment`),
        ).not.toContain("minecraft:protection");
        await rcon.command(
          `execute in ${dimension} run gamerule minecraft:natural_health_regeneration false`,
        );
        // Keep unrelated fighters at the far base while genuine client attack packets exercise
        // the rules. The selected bot keeps its normal AI, health and immunity.
        for (const name of names.filter((candidate) => candidate !== victim)) {
          await rcon.command(
            `execute in ${dimension} run minecraft:tp ${body(name)} 55.5 65 31.5`,
          );
        }
        bot.setQuickBarSlot(1);
        await eventually(
          "the human's Trooper sword",
          async () => bot.heldItem?.name === "iron_sword",
        );
        expect(
          await rcon.command(
            `data get entity ${bot.username} SelectedItem.components."minecraft:enchantments"."minecraft:sharpness"`,
          ),
        ).toMatch(/: 1$/u);
        const hp = async () =>
          HealthSchema.parse(
            await rcon.command(`data get entity ${body(victim)} Health`),
          );
        const offer = async () => {
          await rcon.command(
            `execute in ${dimension} run minecraft:tp ${body(victim)} 24.5 65 30.5`,
          );
          await rcon.command(
            `execute in ${dimension} run minecraft:tp ${bot.username} 25.5 65 30.5`,
          );
          await eventually("the current bot body in reach", async () => {
            const current = match.view.entity(victim);
            return (
              current !== undefined &&
              current.position.distanceTo(bot.entity.position) < 3
            );
          });
          const current = match.view.entity(victim);
          if (current === undefined) throw new Error("the bot body vanished");
          await bot.lookAt(current.position.offset(0, 1, 0), true);
          return current;
        };
        const before = await hp();
        expect(before).toBe(20);
        bot.attack(await offer());
        await eventually(
          "a human sword hit on the lobby-to-map body",
          async () => (await hp()) < before,
        );
        const first = await hp();
        expect(first).toBeCloseTo(before - 2.9, 1);

        const transferred = z
          .object({
            uuid: z.uuid(),
            entities: z.array(z.number().int()).length(3),
            health: z.number(),
            invulnerable: z.literal(false),
            equipmentPreserved: z.literal(true),
            registered: z.literal(true),
          })
          .parse(
            JSON.parse(
              plain(await rcon.command(`storm-fixture-bot-transfer ${victim}`)),
            ),
          );
        expect(new Set(transferred.entities).size).toBe(3);
        expect(transferred.health).toBeCloseTo(first, 1);
        expect(transferred.uuid).toBe(match.view.profiles.get(victim)?.uuid);
        // A replacement inherits the normal hit window. After it decays, another real swing
        // lowers health by the same amount instead of awaiting a nonexistent client ACK.
        await Bun.sleep(750);
        bot.attack(await offer());
        await eventually(
          "a human sword hit after map-to-lobby-to-map",
          async () => (await hp()) < first,
        );
        expect(await hp()).toBeCloseTo(first - 2.9, 1);
        expect(await serverLogs(server)).not.toContain("IllegalAccessError");
      } finally {
        try {
          await rcon.command(
            `execute in ${dimension} run gamerule minecraft:natural_health_regeneration true`,
          );
          await rcon.command("rwf admin forcestop");
          await waitForLobby(rcon);
          if (matchId !== undefined) {
            const settled = await settledMatch(server, matchId);
            await gzipLines(
              server,
              settled.match.recording_file ?? "",
              settled.outDir,
            );
          }
        } finally {
          await setRwfFeatures(brain.port, previousFeatures);
          await rcon.command("rwf admin forcestop");
          await waitForLobby(rcon);
        }
      }
    },
  );

  test(
    "a hurt Trooper with no enemy near eats a golden apple, and bots never enter Citizens' saved NPCs",
    { timeout: 240_000 },
    async ({ rcon, server }) => {
      const { match: settings } = await ownedYaml("rwf.yml", OwnedRwfSchema);
      const { human, names, eaters, matchId } = await liveWithEater(
        rcon,
        server,
        await personalities(),
        settings.targetCombatants,
      );
      try {
        await eatsAndStaysUnsaved(rcon, server, {
          human,
          names,
          eaters,
          matchId,
        });
      } finally {
        await disconnectBot(human);
      }
    },
  );
});

/**
 * Citizens' saved registry never lists a bot, and a hurt Trooper with no
 * enemy near eats a golden apple, which its recording keeps.
 */
async function eatsAndStaysUnsaved(
  rcon: RconClient,
  server: ServerInfo,
  { human, names, eaters, matchId }: EaterMatch,
): Promise<void> {
  // Bodies live in rwfbots' in-memory registry: Citizens' own (saved)
  // registry lists none of them, before or after a forced save.
  await rcon.command("citizens save");
  const listed = plain(await rcon.command("npc list"));
  // An empty listing still prints its page header.
  expect(listed).toMatch(/\[ NPCs \d+\/\d+ \]/u);
  for (const name of names) {
    expect(listed, `${name} in Citizens' registry`).not.toContain(name);
  }

  // At live the teams stand at their bases, forty blocks apart: well
  // below ten health and with no enemy within four blocks, a Trooper
  // eats (32 ticks) and gains the apple's absorption.
  for (const name of eaters) {
    await rcon.command(`damage ${body(name)} 12 minecraft:out_of_world`);
  }
  const absorbing = async () =>
    Promise.all(
      eaters.map(async (name) =>
        AbsorptionSchema.parse(
          await rcon.command(`data get entity ${body(name)} AbsorptionAmount`),
        ),
      ),
    );
  await eventually(
    "a hurt Trooper to eat a golden apple",
    async () => {
      const amounts = await absorbing();
      return amounts.some((amount) => amount > 0);
    },
    15_000,
  );

  // Absorption comes only from a finished bite, which used one of three.
  const amounts = await absorbing();
  const ate = eaters.filter((_, index) => (amounts[index] ?? 0) > 0);
  expect(ate.length).toBeGreaterThan(0);
  for (const name of ate) {
    expect(
      await rcon.command(
        `execute if data entity ${body(name)} Inventory[{id:"minecraft:golden_apple",count:2}]`,
      ),
      `${name} has two golden apples left`,
    ).toContain("Test passed");
  }

  // Leaving stops the match, and nothing of the bots is left behind.
  human.chat("/rwf leave");
  await eventually(
    "the stopped match's recording",
    async () => {
      const rows = await matchRows(server, matchId);
      return (rows.match?.recording_file ?? null) !== null;
    },
    30_000,
  );
  await waitForLobby(rcon);
  const after = plain(await rcon.command("npc list"));
  for (const name of names) {
    expect(after).not.toContain(name);
  }
}

/** When a team's width across the yard is first taken: 8 s. */
const SPREAD_TICKS = 160;
/** The yardstick for crossing the own third: 10 s. */
const BY_TICKS = 200;

/*
 * One match is one draw, so these floors sit below what single showcases
 * measure and well above a team that bunches and beelines (median spacing
 * about 2 blocks, 5 to 7 blocks wide, an eighth past its third). The sim's
 * AdvanceTest holds the averages over every strategy pairing.
 */
/** The least median gap to the nearest teammate before first contact. */
const MIN_SPACING = 2.5;
/** The narrowest a team may be across the 64-block yard. */
const MIN_WIDTH = 16;
/** The most a team may walk for the ground it gains (circling walks a lot). */
const MAX_WINDING = 2.5;
/** The least share of a team past its own third by 10 s (anchors stay home). */
const MIN_FORWARD = 1 / 4;

const ReplayPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
const ReplaySchema = z.object({
  originalMatch: z.literal("d3b07b36-0f40-47ff-880f-1e509bc41c17"),
  match: z.uuid(),
  seed: z.literal("3820972541116702293"),
  settings: z.string().min(1),
  phase: z.string().min(1),
  chatSeedPinned: z.literal(false),
  nativeAcceptance: z.literal("not-exposed"),
  roster: z
    .array(
      z.object({
        personality: z.string().min(1),
        kit: z.enum(["TROOPER", "LONGBOW", "SHORTBOW", "REWIND"]),
        team: z.enum(["blue", "red"]),
      }),
    )
    .length(16),
  ticks: z
    .array(
      z.object({
        serverTick: z.number().int().nonnegative(),
        authoredTick: z.number().int().nonnegative(),
        liveTick: z.number().int().nonnegative(),
        bodies: z
          .array(
            z.object({
              identity: z.object({
                slot: z.number().int().min(0).max(15),
                personality: z.string().min(1),
                body: z.uuid(),
                team: z.enum(["blue", "red"]),
                kit: z.enum(["trooper", "longbow", "shortbow", "rewind"]),
              }),
              pose: z.object({
                at: ReplayPointSchema,
                velocity: ReplayPointSchema,
                health: z.number().nonnegative(),
                fallDistance: z.number().nonnegative(),
                sprint: z.boolean(),
              }),
              activity: z.object({
                typingIndicator: z.boolean(),
                activeItem: z.boolean(),
                casting: z.boolean(),
              }),
              intent: z
                .object({
                  decisionTick: z.number().int(),
                  plan: z.string(),
                  option: z.string(),
                  commands: z.array(z.string()),
                  waypoints: z.array(z.string()),
                })
                .optional(),
            }),
          )
          .max(16),
      }),
    )
    .max(240),
});

async function originalReplay(rcon: RconClient, request: "start" | "status") {
  return ReplaySchema.parse(
    JSON.parse(
      plain(
        await rcon.command(`storm-fixture-map-lifecycle replay-${request}`),
      ),
    ),
  );
}

async function startOriginalShowcase(rcon: RconClient) {
  await originalReplay(rcon, "start");
  await eventually(
    "the original cohort to go live",
    async () => liveStatus(rcon),
    30_000,
  );
  const live = await status(rcon);
  expect([live.humans, live.bots]).toEqual([0, 16]);
  return live;
}

/**
 * How a showcase was played, from its recording: spacing and crowding before
 * first contact, width across the yard at 8 s and at contact, the share past
 * its own third by 10 s, and how much each team walked for the ground it
 * gained before contact.
 */
function expectTeamPlay(trails: Trails): void {
  const contact = trails.firstContact ?? trails.lastTick + 1;
  const spread = dispersion(trails, { from: 0, until: contact });
  expect(spread.map((team) => team.team)).toEqual(["BLUE", "RED"]);
  for (const team of spread) {
    expect(team.samples, `${team.team} samples`).toBeGreaterThan(0);
    // Spawn points stand two blocks apart.
    expect(
      team.nearestP50,
      `${team.team} nearest-teammate p50 before first contact`,
    ).toBeGreaterThanOrEqual(MIN_SPACING);
  }
  const at8 = advance(trails, { at: SPREAD_TICKS, until: contact });
  const atContact = advance(trails, { at: contact, until: contact });
  const by10 = advance(trails, { at: BY_TICKS, until: BY_TICKS });
  for (const [index, team] of at8.entries()) {
    const name = team.team;
    expect(team.spreadAt, `${name} width at 8 s`).toBeGreaterThanOrEqual(
      MIN_WIDTH,
    );
    expect(
      atContact[index]?.spreadAt,
      `${name} width at first contact`,
    ).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(
      atContact[index]?.winding,
      `${name} walked over ground gained before contact`,
    ).toBeLessThanOrEqual(MAX_WINDING);
    expect(
      by10[index]?.forward,
      `${name} share past its own third by 10 s`,
    ).toBeGreaterThanOrEqual(MIN_FORWARD);
  }
}

describe("Search and Destroy rwfbots team play", () => {
  test(
    "a sixteen-bot showcase moves each team up the field spread across the yard and still finishes",
    { timeout: 16 * 60_000 },
    async ({ rcon, server }) => {
      await waitForLobby(rcon);
      const size = 16;
      await usingShowcase(
        rcon,
        size,
        async (live) => {
          // What each bot was dealt, kept beside the recording for `rwf:trails`.
          await Bun.sleep(4000);
          const slots = plain(await rcon.command("rwfbots debug slots"));
          expect(slots).toMatch(/objective/u);
          await eventually(
            "the showcase to end and its recording to close",
            async () => {
              const rows = await matchRows(server, live.matchId);
              return (rows.match?.recording_file ?? null) !== null;
            },
            matchBudgetMs,
          );
          const settled = await matchRows(server, live.matchId);
          expect(settled.match?.winner).toMatch(/^(?:RED|BLUE)$/u);
          const replay = await originalReplay(rcon, "status");
          expect(replay.match).toBe(live.matchId);
          expect(replay.ticks.length).toBeGreaterThanOrEqual(BY_TICKS);
          await Bun.write(
            path.join(settled.outDir, "opening-replay.json"),
            JSON.stringify(replay, null, 2),
          );
          await Bun.write(path.join(settled.outDir, "slots.txt"), slots);
          const traces = await gzipLines(
            server,
            `rwfbots-traces/${live.matchId}.gz`,
            settled.outDir,
          );
          expect(traces.every((line) => line.startsWith("decision\t"))).toBe(
            true,
          );
          const trails = readTrails(
            await gzipLines(
              server,
              settled.match?.recording_file ?? "",
              settled.outDir,
            ),
          );
          expect(trails.mapId).toBe("training-yard");
          expectTeamPlay(trails);
        },
        () => startOriginalShowcase(rcon),
      );
    },
  );
});
