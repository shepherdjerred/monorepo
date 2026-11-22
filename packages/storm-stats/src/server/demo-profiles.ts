import {
  ActivityGroupSchema,
  BounceCategorySchema,
  GameModeSchema,
  PlatformSchema,
  WorldBucketSchema,
  type ActivityGroup,
  type GameMode,
  type IngestEvent,
  type Platform,
  type PlayerGameplaySnapshot,
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
  readonly townRole: string | null;
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
  { name: "Windmill", members: 9, claims: 64, kind: "settlement" },
  { name: "Skylands Haven", members: 7, claims: 52, kind: "sky-citadel" },
  { name: "Rustworks", members: 5, claims: 41, kind: "industrial" },
  { name: "Frostpeak", members: 4, claims: 28, kind: "outpost" },
  { name: "Coral Reach", members: 3, claims: 19, kind: "port" },
];

const COMPACT_SPECS = [
  "1, Jerred, Stormwarden, regular, java, 1.21.4, fabric, admin, Windmill, mayor, US, United States, ts-mc.net, 24, world, survival, Netherite Sword, 89, 1",
  "2, AetherialKite, Kite, regular, java, 1.21.4, fabric, mod, Skylands Haven, mayor, CA, Canada, mc.ts-mc.net, 38, skylands, survival, Power V Bow, 86, 1",
  "3, Cinder Forge, Cinder, regular, java, 1.21.4, sodium, supporter, Rustworks, mayor, US, United States, ts-mc.net, 31, world_nether, survival, Mace, 82, 1",
  "4, WoolRunnerX, Runner, regular, java, 1.21.4, lunarclient:v2.18.1, supporter, Windmill, officer, US, United States, join.ts-mc.net, 29, rwf, rwf, Netherite Sword, 78, 1",
  "5, ValkyrieFrost, Val, regular, java, 1.21.4, fabric, default, Frostpeak, mayor, SE, Sweden, mc.ts-mc.net, 112, arena, arena, Diamond Axe, 74, 1",
  "6, Tidecaller Kai, -, regular, bedrock, 1.21.50, Geyser, supporter, Coral Reach, mayor, US, United States, bedrock.ts-mc.net, 46, world, survival, Trident, 70, 1",
  "7, RedstoneMira, Mira, active, java, 1.21.4, fabric, default, Rustworks, engineer, DE, Germany, ts-mc.net, 108, world, survival, Crossbow, 65, 0",
  "8, BreezeHunter, -, active, java, 1.21.4, vanilla, default, Skylands Haven, resident, GB, United Kingdom, ts-mc.net, 94, skylands, survival, Mace, 60, 0",
  "9, OpalArchitect, Opal, active, java, 1.21.4, fabric, builder, Windmill, builder, US, United States, mc.ts-mc.net, 34, creative, creative, Diamond Sword, 55, 0",
  "10, NetherNomad, -, active, java, 1.21.3, sodium, default, Rustworks, resident, CA, Canada, join.ts-mc.net, 42, world_nether, survival, Netherite Axe, 51, 0",
  "11, EnderScribe, Scribe, active, java, 1.21.4, vanilla, default, Skylands Haven, officer, NL, Netherlands, ts-mc.net, 103, world_the_end, survival, Netherite Sword, 46, 0",
  "12, PocketMiner99, -, active, bedrock, 1.21.50, Geyser, default, Windmill, resident, US, United States, bedrock.ts-mc.net, 52, world, survival, Diamond Sword, 40, 0",
  "13, GlacierSpear, -, active, java, 1.21.4, lunarclient:v2.18.1, default, Frostpeak, officer, AU, Australia, mc.ts-mc.net, 178, rwf, rwf, Power V Bow, 34, 0",
  "14, MossyCobble, Moss, irregular, java, 1.21.4, vanilla, default, Windmill, resident, US, United States, ts-mc.net, 39, world, survival, Iron Sword, 62, 0",
  "15, SakuraLantern, -, irregular, java, 1.21.4, fabric, default, Coral Reach, resident, JP, Japan, ts-mc.net, 142, world, survival, Diamond Sword, 48, 0",
  "16, CopperGolemFan, -, irregular, java, 1.21.3, vanilla, default, Rustworks, resident, US, United States, join.ts-mc.net, 44, arena, arena, Diamond Axe, 30, 0",
  "17, SkyPirateZed, Zed, irregular, java, 1.21.4, sodium, default, Skylands Haven, resident, BR, Brazil, mc.ts-mc.net, 136, skylands, survival, Crossbow, 26, 0",
  "18, BedrockBerry, -, irregular, bedrock, 1.21.50, Geyser, default, Windmill, resident, CA, Canada, bedrock.ts-mc.net, 58, world, survival, Trident, 20, 0",
  "19, DeepslateDelver, -, irregular, java, 1.21.4, fabric, default, Frostpeak, resident, US, United States, ts-mc.net, 36, world, survival, Netherite Sword, 15, 0",
  "20, SproutNewbie, -, irregular, java, 1.21.4, vanilla, default, -, -, US, United States, join.ts-mc.net, 41, world, survival, Iron Sword, 5, 0",
  "21, AutumnWanderer, -, inactive, java, 1.21.3, vanilla, default, Windmill, resident, US, United States, ts-mc.net, 47, world, survival, Diamond Sword, 88, 0",
  "22, QuartzMason, -, inactive, java, 1.21.3, fabric, default, Skylands Haven, resident, GB, United Kingdom, mc.ts-mc.net, 99, creative, creative, Iron Sword, 84, 0",
  "23, BlazeRodBaron, Baron, inactive, java, 1.21.3, sodium, default, Rustworks, resident, DE, Germany, ts-mc.net, 115, world_nether, survival, Diamond Axe, 79, 0",
  "24, SnowfoxScout, -, inactive, bedrock, 1.21.44, Geyser, default, Frostpeak, resident, CA, Canada, bedrock.ts-mc.net, 63, world, survival, Power V Bow, 72, 0",
  "25, CoralDiver, -, inactive, java, 1.21.3, vanilla, default, Coral Reach, resident, AU, Australia, join.ts-mc.net, 184, world, survival, Trident, 68, 0",
  "26, PhantomSlayer, -, inactive, java, 1.21.3, lunarclient:v2.18.1, default, Skylands Haven, resident, US, United States, ts-mc.net, 33, rwf, rwf, Netherite Sword, 64, 0",
  "27, BirchLogger, -, inactive, java, 1.21.3, vanilla, default, -, -, US, United States, join.ts-mc.net, 51, world, survival, Iron Sword, 56, 0",
  "28, OneLookTourist, -, inactive, java, 1.21.3, vanilla, default, -, -, NL, Netherlands, ts-mc.net, 110, world, survival, Stone Sword, 44, 0",
] as const;

function nullableField(raw: string | undefined): string | null {
  return raw === undefined || raw === "-" ? null : raw;
}

function parseCompactPlayer(spec: string): DemoPlayerSeed {
  const parts = spec.split(", ");
  return {
    index: Number(parts[0]),
    name: parts[1] ?? "Player",
    nickname: nullableField(parts[2]),
    archetype: ActivityGroupSchema.parse(parts[3]),
    platform: PlatformSchema.parse(parts[4]),
    clientVersion: parts[5] ?? "1.21.4",
    clientBrand: nullableField(parts[6]),
    primaryGroup: parts[7] ?? "default",
    townName: nullableField(parts[8]),
    townRole: nullableField(parts[9]),
    countryCode: parts[10] ?? "US",
    countryName: parts[11] ?? "United States",
    joinAddress: parts[12] ?? "ts-mc.net",
    basePingMs: Number(parts[13]),
    favWorld: WorldBucketSchema.parse(parts[14]),
    favMode: GameModeSchema.parse(parts[15]),
    favWeapon: parts[16] ?? "Iron Sword",
    firstSeenDaysAgo: Number(parts[17]),
    onlineNow: parts[18] === "1",
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

const SKILLS = [
  "mining",
  "woodcutting",
  "excavation",
  "swords",
  "archery",
  "acrobatics",
  "alchemy",
  "fishing",
] as const;

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

  for (const skill of SKILLS) {
    const level = Math.max(5, Math.round((25 + rand() * 190) * mult));
    skills[skill] = level;
    powerLevel += level;
    if (level > topSkillLevel) {
      topSkillLevel = level;
      topSkill = skill;
    }
  }

  const townClaims =
    player.townName === null
      ? 0
      : (DEMO_TOWNS.find((t) => t.name === player.townName)?.claims ?? 16);
  const rwfMatches =
    player.favMode === "rwf" || player.archetype === "regular"
      ? Math.round((4 + rand() * 22) * (mult / 2))
      : Math.floor(rand() * 4);
  const rwfWins = Math.min(
    rwfMatches,
    Math.round(rwfMatches * (0.42 + rand() * 0.35)),
  );
  const arenaBestWaves: Record<string, number> = {
    catacombs: Math.round((6 + rand() * 28) * (mult / 2)),
    frost_citadel: Math.round((4 + rand() * 22) * (mult / 2)),
  };
  if (player.archetype === "regular" || player.favMode === "arena") {
    arenaBestWaves["ember_pit"] = Math.round(14 + rand() * 26);
  }

  return {
    playerUuid: playerUuidFor(player.index),
    playerName: player.name,
    capturedAt,
    nickname: player.nickname,
    primaryGroup: player.primaryGroup,
    coins: Math.round((850 + rand() * 24_000) * mult),
    townName: player.townName,
    townRole: player.townRole,
    townClaims,
    powerLevel,
    topSkill,
    topSkillLevel,
    skills,
    tracks: {
      explorer: Math.min(10, Math.max(1, Math.round(mult * 2.2))),
      builder: Math.min(10, Math.max(1, Math.round(mult * 1.9))),
      gladiator: Math.min(10, Math.max(1, Math.round(mult * 1.7))),
    },
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
  "2|-|CuriousFriend|allowlist|Apply on Discord to join The Storm allowlist|join.ts-mc.net",
  "4|4|WoolRunnerX|maintenance|Paper 1.21.4 rolling restart in progress|join.ts-mc.net",
  "6|12|PocketMiner99|kicked|Geyser Floodgate session expired; please reconnect|bedrock.ts-mc.net",
  "9|-|UnlistedVisitor|allowlist|Apply on Discord to join The Storm allowlist|ts-mc.net",
  "12|3|Cinder Forge|maintenance|Scheduled backup window|ts-mc.net",
  "15|17|SkyPirateZed|full|RWF tournament lobby is at capacity|mc.ts-mc.net",
  "19|-|AltScanner99|banned|IP enforcement policy block|ts-mc.net",
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
