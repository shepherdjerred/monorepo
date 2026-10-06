import path from "node:path";
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
import {
  fullRwfTestSettings,
  rwfTestSettings,
} from "#e2e/harness/rwf-settings.ts";
import {
  balance,
  type ClientView,
  clientView,
  debug,
  diamonds,
  escaped,
  expectSampleCadence,
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
  const seen = await log.until(/You are in (?<team>Red|Blue) Team\./u, 30_000);
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
  expect(started).toContain(`Showcase of ${size.toString()} bots started`);
  await eventually(
    "the showcase to go live",
    async () => liveStatus(rcon),
    30_000,
  );
  const live = await status(rcon);
  expect([live.humans, live.bots]).toEqual([0, size]);
  return live;
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
const lobbyRoom = { min: [128, 64, 16], max: [158, 72, 46] } as const;

function inLobby(at: Vec3): boolean {
  return (
    at.x >= lobbyRoom.min[0] &&
    at.x < lobbyRoom.max[0] + 1 &&
    at.y >= lobbyRoom.min[1] &&
    at.y < lobbyRoom.max[1] + 1 &&
    at.z >= lobbyRoom.min[2] &&
    at.z < lobbyRoom.max[2] + 1
  );
}

/** What the human's client and `/rwf who` showed of the bots during the countdown. */
type LobbyWatch = {
  /** Every kit `/rwf who` listed for each bot, in the order seen. */
  kits: Map<string, string[]>;
  /** Where the human's client saw each bot, sample by sample. */
  positions: Map<string, Vec3[]>;
  /** Bots the human's client saw crouch. */
  crouched: Set<string>;
  /** Stops sampling. */
  stop: () => Promise<void>;
};

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
      const begun = match.log.has(/The game has begun!/u);
      for (const seen of Object.values(bot.entities)) {
        const name = seen.username;
        if (!begun && name !== undefined && name !== bot.username) {
          const samples = watch.positions.get(name) ?? [];
          samples.push(seen.position.clone());
          watch.positions.set(name, samples);
        }
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
  expect(
    names.filter((name) => (watch.positions.get(name)?.length ?? 0) > 0),
    "the human's client sees the bots in the lobby",
  ).not.toHaveLength(0);
  for (const name of names) {
    const samples = watch.positions.get(name) ?? [];
    for (const at of samples) {
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
      : Math.max(0, ...samples.map((at) => at.distanceTo(first)));
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
  const live = await startShowcase(rcon, size);
  expect(plain(await rcon.command("rwf admin status"))).toContain(
    "Watchers: 1, showcase: yes",
  );

  // The watcher follows a living bot.
  bot.chat("/rwf spectate next");
  const followed = await match.log.until(/Following (?<name>\w+)\./u);
  expect(match.catalog.has(followed.groups?.["name"] ?? "")).toBe(true);

  await showcaseSettles(server, live.matchId, size, statsBefore);

  // Bot chat (the-storm-rwfbots-chat-enabled is on in the fake Flipt):
  // the watcher in the rwf world hears ✦-marked lines from the showcase's
  // bots; the player in the main world hears none of them.
  const botLines = match.log.all(/^\[(?<name>\w+) ✦\]: .+$/u);
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

      const lobby = watchLobby(match);
      const names = await fillsWithBots(match);
      await liveInTheLobby(match, lobby, names);
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
        expect(await balance(human)).toBe(startingBalance);
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
      const live = await startShowcase(rcon, size);
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
      await Bun.write(path.join(settled.outDir, "slots.txt"), slots);
      const traces = await gzipLines(
        server,
        `rwfbots-traces/${live.matchId}.gz`,
        settled.outDir,
      );
      expect(traces.every((line) => line.startsWith("decision\t"))).toBe(true);
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
  );
});
