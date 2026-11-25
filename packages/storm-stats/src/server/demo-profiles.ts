import {
  ActivityGroupSchema,
  BounceCategorySchema,
  GameModeSchema,
  MAX_TRACK_LEVEL,
  PlatformSchema,
  PlayerHomeKindSchema,
  STORM_SKILLS,
  STORM_TRACKS,
  WorldBucketSchema,
  type ActivityGroup,
  type GameMode,
  type IngestEvent,
  type Platform,
  type PlayerGameplaySnapshot,
  type PlayerHomeKind,
  type TownSummarySnapshot,
  type WorldBucket,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { DAY_MS, HOUR_MS } from "./time.ts";

export type DemoPlayerSeed = {
  readonly index: number;
  readonly name: string;
  readonly nickname: string | null;
  readonly archetype: ActivityGroup;
  readonly platform: Platform;
  readonly clientVersion: string;
  readonly clientBrand: string | null;
  readonly primaryGroup: string;
  readonly townName: string | null;
  readonly townKind: PlayerHomeKind | null;
  readonly townRole: string | null;
  readonly campClaims: number;
  readonly countryCode: string;
  readonly countryName: string;
  readonly joinAddress: string;
  readonly basePingMs: number;
  readonly favWorld: WorldBucket;
  readonly favMode: GameMode;
  readonly favWeapon: string;
  readonly firstSeenDaysAgo: number;
  readonly onlineNow: boolean;
};

export const DEMO_TOWNS: readonly TownSummarySnapshot[] = [
  { name: "Altaria", members: 7, claims: 64, kind: "player" },
  { name: "Karthil", members: 5, claims: 52, kind: "player" },
  { name: "Frost Falls", members: 4, claims: 41, kind: "player" },
  { name: "Starvationville", members: 4, claims: 28, kind: "player" },
  { name: "Leronfell", members: 3, claims: 19, kind: "player" },
];

const COMPACT_SPECS = [
  "1, Jerred, Stormwarden, regular, java, 26.3, fabric, admin, Altaria, town, owner, 0, US, United States, ts-mc.net, 24, frontier, survival, Netherite Sword, 89, 1",
  "2, AetherialKite, Kite, regular, java, 26.3, fabric, mod, Karthil, town, owner, 0, CA, Canada, mc.ts-mc.net, 38, skylands, survival, Power V Bow, 86, 1",
  "3, Cinder Forge, Cinder, regular, java, 26.3, sodium, supporter, Starvationville, town, owner, 0, US, United States, ts-mc.net, 31, world_nether, survival, Mace, 82, 1",
  "4, FuseRunner, Runner, regular, java, 26.3, lunarclient:v2.18.1, supporter, Altaria, town, assistant, 0, US, United States, ts-mc.net, 29, rwf, rwf, Netherite Sword, 78, 1",
  "5, ValkyrieFrost, Val, regular, java, 26.3, fabric, default, Frost Falls, town, owner, 0, SE, Sweden, mc.ts-mc.net, 112, arena, arena, Diamond Axe, 74, 1",
  "6, Tidecaller Kai, -, regular, bedrock, bedrock, Geyser, supporter, Leronfell, town, owner, 0, US, United States, ts-mc.net, 46, frontier, survival, Trident, 70, 1",
  "7, RedstoneMira, Mira, active, java, 26.3, fabric, default, Starvationville, town, assistant, 0, DE, Germany, ts-mc.net, 108, frontier, survival, Crossbow, 65, 0",
  "8, BreezeHunter, -, active, java, 26.3, vanilla, default, Karthil, town, member, 0, GB, United Kingdom, ts-mc.net, 94, skylands, survival, Mace, 60, 0",
  "9, OpalArchitect, Opal, active, java, 26.3, fabric, supporter, Altaria, town, member, 0, US, United States, mc.ts-mc.net, 34, creative, creative, Diamond Sword, 55, 0",
  "10, NetherNomad, -, active, java, 26.3, sodium, default, NetherNomad, camp, owner, 9, CA, Canada, mc.ts-mc.net, 42, world_nether, survival, Netherite Axe, 51, 0",
  "11, EnderScribe, Scribe, active, java, 26.3, vanilla, default, Karthil, town, assistant, 0, NL, Netherlands, ts-mc.net, 103, world_the_end, survival, Netherite Sword, 46, 0",
  "12, PocketMiner99, -, active, bedrock, bedrock, Geyser, default, Altaria, town, member, 0, US, United States, ts-mc.net, 52, frontier, survival, Diamond Sword, 40, 0",
  "13, GlacierSpear, -, active, java, 26.3, lunarclient:v2.18.1, default, Frost Falls, town, assistant, 0, AU, Australia, mc.ts-mc.net, 178, rwf, rwf, Power V Bow, 34, 0",
  "14, MossyCobble, Moss, irregular, java, 26.3, vanilla, default, Altaria, town, member, 0, US, United States, ts-mc.net, 39, world, survival, Iron Sword, 62, 0",
  "15, SakuraLantern, -, irregular, java, 26.3, fabric, default, Leronfell, town, member, 0, JP, Japan, ts-mc.net, 142, map2, survival, Diamond Sword, 48, 0",
  "16, CopperGolemFan, -, irregular, java, 26.3, vanilla, default, Starvationville, town, member, 0, US, United States, mc.ts-mc.net, 44, arena, arena, Diamond Axe, 30, 0",
  "17, SkyPirateZed, Zed, irregular, java, 26.3, sodium, default, Karthil, town, member, 0, BR, Brazil, mc.ts-mc.net, 136, skylands, survival, Crossbow, 26, 0",
  "18, BedrockBerry, -, irregular, bedrock, bedrock, Geyser, default, Altaria, town, member, 0, CA, Canada, ts-mc.net, 58, frontier, survival, Trident, 20, 0",
  "19, DeepslateDelver, -, irregular, java, 26.3, fabric, default, NetherNomad, camp, member, 9, US, United States, ts-mc.net, 36, frontier, survival, Netherite Sword, 15, 0",
  "20, SproutNewbie, -, irregular, java, 26.3, vanilla, default, SproutNewbie, camp, owner, 4, US, United States, mc.ts-mc.net, 41, frontier, survival, Iron Sword, 5, 0",
  "21, AutumnWanderer, -, inactive, java, 1.21.11, vanilla, default, Altaria, town, member, 0, US, United States, ts-mc.net, 47, world, survival, Diamond Sword, 88, 0",
  "22, QuartzMason, -, inactive, java, 26.3, fabric, default, Karthil, town, member, 0, GB, United Kingdom, mc.ts-mc.net, 99, creative, creative, Iron Sword, 84, 0",
  "23, BlazeRodBaron, Baron, inactive, java, 1.21.11, sodium, default, Starvationville, town, member, 0, DE, Germany, ts-mc.net, 115, world_nether, survival, Diamond Axe, 79, 0",
  "24, SnowfoxScout, -, inactive, bedrock, bedrock, Geyser, default, Frost Falls, town, member, 0, CA, Canada, ts-mc.net, 63, map2, survival, Power V Bow, 72, 0",
  "25, CoralDiver, -, inactive, java, 1.21.11, vanilla, default, Leronfell, town, member, 0, AU, Australia, mc.ts-mc.net, 184, frontier, survival, Trident, 68, 0",
  "26, PhantomSlayer, -, inactive, java, 26.3, lunarclient:v2.18.1, default, Frost Falls, town, member, 0, US, United States, ts-mc.net, 33, rwf, rwf, Netherite Sword, 64, 0",
  "27, BirchLogger, -, inactive, java, 1.21.11, vanilla, default, -, -, -, 0, US, United States, mc.ts-mc.net, 51, world, survival, Iron Sword, 56, 0",
  "28, OneLookTourist, -, inactive, java, 26.3, vanilla, default, -, -, -, 0, NL, Netherlands, ts-mc.net, 110, frontier, survival, Stone Sword, 44, 0",
] as const;

function nullableField(raw: string | undefined): string | null {
  return raw === undefined || raw === "-" ? null : raw;
}

function nullableHomeKind(raw: string | undefined): PlayerHomeKind | null {
  const value = nullableField(raw);
  return value === null ? null : PlayerHomeKindSchema.parse(value);
}

function parseCompactPlayer(spec: string): DemoPlayerSeed {
  const parts = spec.split(", ");
  return {
    index: Number(parts[0]),
    name: parts[1] ?? "Player",
    nickname: nullableField(parts[2]),
    archetype: ActivityGroupSchema.parse(parts[3]),
    platform: PlatformSchema.parse(parts[4]),
    clientVersion: parts[5] ?? "26.3",
    clientBrand: nullableField(parts[6]),
    primaryGroup: parts[7] ?? "default",
    townName: nullableField(parts[8]),
    townKind: nullableHomeKind(parts[9]),
    townRole: nullableField(parts[10]),
    campClaims: Number(parts[11] ?? "0"),
    countryCode: parts[12] ?? "US",
    countryName: parts[13] ?? "United States",
    joinAddress: parts[14] ?? "ts-mc.net",
    basePingMs: Number(parts[15]),
    favWorld: WorldBucketSchema.parse(parts[16]),
    favMode: GameModeSchema.parse(parts[17]),
    favWeapon: parts[18] ?? "Iron Sword",
    firstSeenDaysAgo: Number(parts[19]),
    onlineNow: parts[20] === "1",
  };
}

export const DEMO_PLAYERS: readonly DemoPlayerSeed[] = COMPACT_SPECS.map((s) =>
  parseCompactPlayer(s),
);

export function deterministicUuid(prefixHex: string, seq: number): string {
  const hi = ((seq >>> 16) & 65_535).toString(16).padStart(4, "0");
  const lo = (seq & 65_535).toString(16).padStart(12, "0");
  return `${prefixHex}-${hi}-4000-8000-${lo}`;
}

export function playerUuidFor(index: number): string {
  return deterministicUuid("57040000", index);
}

function tierMultiplierFor(player: DemoPlayerSeed): number {
  switch (player.archetype) {
    case "regular":
      return 4;
    case "active":
      return 2.4;
    case "irregular":
      return 1.2;
    case "inactive":
      return 0.7;
  }
}

function buildDemoTracks(
  player: DemoPlayerSeed,
  rand: () => number,
): Record<string, number> {
  const primaryTrackIndex = player.index % STORM_TRACKS.length;
  let primaryCeiling = 1;
  switch (player.archetype) {
    case "regular":
      primaryCeiling = MAX_TRACK_LEVEL;
      break;
    case "active":
      primaryCeiling = 4;
      break;
    case "irregular":
      primaryCeiling = 2;
      break;
    case "inactive":
      primaryCeiling = 1;
      break;
  }

  const tracks: Record<string, number> = {};
  for (const [idx, track] of STORM_TRACKS.entries()) {
    if (player.index === 28) {
      tracks[track] = 0;
    } else if (idx === primaryTrackIndex) {
      tracks[track] = Math.min(
        MAX_TRACK_LEVEL,
        Math.max(1, Math.round(primaryCeiling * (0.7 + rand() * 0.3))),
      );
    } else {
      const secondaryCap = player.archetype === "regular" ? 2 : 1;
      tracks[track] = rand() < 0.45 ? Math.round(rand() * secondaryCap) : 0;
    }
  }
  return tracks;
}

function resolveHomeClaims(player: DemoPlayerSeed): number {
  if (player.townName === null) {
    return 0;
  }
  return player.townKind === "camp"
    ? player.campClaims
    : (DEMO_TOWNS.find((t) => t.name === player.townName)?.claims ?? 16);
}

export function buildDemoGameplaySnapshot(
  player: DemoPlayerSeed,
  capturedAt: string,
  rand: () => number,
): PlayerGameplaySnapshot {
  const mult = tierMultiplierFor(player);
  const skills: Record<string, number> = {};
  let powerLevel = 0;
  let topSkill: string | null = null;
  let topSkillLevel = 0;

  for (const skill of STORM_SKILLS) {
    const level = Math.max(5, Math.round((18 + rand() * 145) * mult));
    skills[skill] = level;
    powerLevel += level;
    if (level > topSkillLevel) {
      topSkillLevel = level;
      topSkill = skill;
    }
  }

  const townClaims = resolveHomeClaims(player);
  const rwfMatches =
    player.favMode === "rwf" || player.archetype === "regular"
      ? Math.round((4 + rand() * 22) * (mult / 2))
      : Math.floor(rand() * 4);
  const rwfWins = Math.min(
    rwfMatches,
    Math.round(rwfMatches * (0.42 + rand() * 0.35)),
  );
  const rwfCredits =
    rwfMatches > 0 ? rwfMatches * Math.round(18 + rand() * 42) : 0;

  const colosseumWave =
    player.index === 28
      ? 0
      : Math.min(72, Math.max(1, Math.round((4 + rand() * 14) * mult)));
  const arenaBestWaves: Record<string, number> =
    colosseumWave > 0 ? { colosseum: colosseumWave } : {};

  return {
    playerUuid: playerUuidFor(player.index),
    playerName: player.name,
    capturedAt,
    nickname: player.nickname,
    primaryGroup: player.primaryGroup,
    crystals: Math.round((120 + rand() * 4200) * mult),
    rwfCredits,
    townName: player.townName,
    townKind: player.townKind,
    townRole: player.townRole,
    townClaims,
    powerLevel,
    topSkill,
    topSkillLevel,
    skills,
    tracks: buildDemoTracks(player, rand),
    questsCompleted: Math.round((5 + rand() * 38) * mult),
    arenaBestWaves,
    rwfMatches,
    rwfWins,
    rwfLosses: Math.max(0, rwfMatches - rwfWins),
    rwfKills: rwfMatches * Math.round(2 + rand() * 5),
    rwfDeaths: rwfMatches * Math.round(1 + rand() * 4),
  };
}

const BOUNCE_SPECS = [
  "1|-|GriefBot_404|banned|Suspended: automated grief client signature|ts-mc.net",
  "2|16|CopperGolemFan|kicked|Timed out waiting for keepalive packet|mc.ts-mc.net",
  "4|4|FuseRunner|maintenance|Paper 26.3 rolling restart in progress|ts-mc.net",
  "6|12|PocketMiner99|kicked|Geyser Floodgate session expired; please reconnect|ts-mc.net",
  "9|24|SnowfoxScout|kicked|Geyser bedrock protocol mismatch; reconnect on latest release|ts-mc.net",
  "12|3|Cinder Forge|maintenance|Paper 26.3 scheduled maintenance window|ts-mc.net",
  "15|17|SkyPirateZed|full|Server is currently full (64/64)|mc.ts-mc.net",
  "19|-|AltScanner99|banned|Suspended: compromised client network signature|ts-mc.net",
] as const;

export function createDemoBounceEvents(
  nowMs: number,
  nextId: () => string,
  rand: () => number,
): IngestEvent[] {
  return BOUNCE_SPECS.map((spec) => {
    const p = spec.split("|");
    const daysAgo = Number(p[0]);
    const playerIdx = p[1] === "-" ? null : Number(p[1]);
    return {
      type: "connection_bounce" as const,
      eventId: nextId(),
      occurredAt: new Date(
        nowMs - daysAgo * DAY_MS - Math.floor(rand() * 8 * HOUR_MS),
      ).toISOString(),
      playerUuid: playerIdx === null ? null : playerUuidFor(playerIdx),
      playerName: p[2] ?? "Visitor",
      category: BounceCategorySchema.parse(p[3]),
      reason: p[4] ?? "Disconnected",
      joinAddress: p[5] ?? "ts-mc.net",
    };
  });
}
