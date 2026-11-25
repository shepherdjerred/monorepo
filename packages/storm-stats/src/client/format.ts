import {
  ARENA_LABELS,
  MODE_LABELS,
  WORLD_LABELS,
  type ActivityGroup,
  type BounceCategory,
  type CombatKind,
  type GameMode,
  type Platform,
  type WorldBucket,
} from "@shepherdjerred/storm-stats/shared/contract.ts";

const INT_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const ONE_DEC_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const TWO_DEC_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const PACIFIC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const PACIFIC_SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

export function formatInt(value: number): string {
  return INT_FORMAT.format(Math.round(value));
}

export function formatCompact(value: number): string {
  return COMPACT_FORMAT.format(value);
}

export function formatDecimal(value: number, digits: 1 | 2 = 1): string {
  return digits === 2
    ? TWO_DEC_FORMAT.format(value)
    : ONE_DEC_FORMAT.format(value);
}

export function formatHours(hours: number): string {
  if (hours === 0) {
    return "0.0h";
  }
  if (hours < 0.1) {
    return `${String(Math.max(1, Math.round(hours * 60)))}m`;
  }
  return hours >= 100
    ? `${INT_FORMAT.format(Math.round(hours))}h`
    : `${ONE_DEC_FORMAT.format(hours)}h`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) {
    return `${String(Math.round(minutes * 60))}s`;
  }
  if (minutes < 60) {
    return `${String(Math.round(minutes))}m`;
  }
  const wholeHours = Math.trunc(minutes / 60);
  const remMinutes = Math.round(minutes % 60);
  return remMinutes === 0
    ? `${String(wholeHours)}h`
    : `${String(wholeHours)}h ${String(remMinutes)}m`;
}

export function formatDurationMs(ms: number): string {
  if (ms <= 0) {
    return "0m";
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const secs = totalSeconds % 60;
    return secs === 0
      ? `${String(totalMinutes)}m`
      : `${String(totalMinutes)}m ${String(secs)}s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (totalHours < 48) {
    return mins === 0
      ? `${String(totalHours)}h`
      : `${String(totalHours)}h ${String(mins)}m`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours === 0
    ? `${String(days)}d`
    : `${String(days)}d ${String(remHours)}h`;
}

export function formatPercent(value: number, digits: 0 | 1 = 1): string {
  return digits === 0
    ? `${String(Math.round(value))}%`
    : `${ONE_DEC_FORMAT.format(value)}%`;
}

export function formatActiveRatio(
  activeMs: number,
  connectedMs: number,
): number {
  return connectedMs <= 0
    ? 0
    : Math.min(100, Math.max(0, (activeMs / connectedMs) * 100));
}

export function formatPing(pingMs: number | null): string {
  return pingMs === null ? "—" : `${String(pingMs)} ms`;
}

export function formatKdr(kills: number, deaths: number): string {
  return deaths <= 0
    ? TWO_DEC_FORMAT.format(kills)
    : TWO_DEC_FORMAT.format(kills / deaths);
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed)
    ? iso
    : `${PACIFIC_DATE_TIME.format(new Date(parsed))} PT`;
}

export function formatCalendarDayLabel(dayIso: string): string {
  const parsed = Date.parse(`${dayIso}T12:00:00Z`);
  return Number.isNaN(parsed)
    ? dayIso
    : PACIFIC_SHORT_DATE.format(new Date(parsed));
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const targetMs = Date.parse(iso);
  if (Number.isNaN(targetMs)) {
    return iso;
  }
  const diffSeconds = Math.round((nowMs - targetMs) / 1000);
  if (diffSeconds < 45) {
    return "just now";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${String(diffMinutes)}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${String(diffHours)}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${String(diffDays)}d ago`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths < 12
    ? `${String(diffMonths)}mo ago`
    : `${String(Math.floor(diffDays / 365))}y ago`;
}

export function formatPlatform(platform: Platform, version?: string): string {
  const base = platform === "java" ? "Java" : "Bedrock";
  return version === undefined || version.trim().length === 0
    ? base
    : `${base} ${version}`;
}

const TRACK_ROMAN_NUMERALS: Readonly<Record<number, string>> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
};

export function formatWorldLabel(world: WorldBucket): string {
  return WORLD_LABELS[world];
}

export function formatModeLabel(mode: GameMode): string {
  return MODE_LABELS[mode];
}

export function formatCrystals(value: number): string {
  const rounded = Math.round(value);
  return rounded === 1 ? "1 crystal" : `${INT_FORMAT.format(rounded)} crystals`;
}

export function formatCredits(value: number): string {
  const rounded = Math.round(value);
  return rounded === 1 ? "1 Credit" : `${INT_FORMAT.format(rounded)} Credits`;
}

export function formatTrackLevel(level: number): string {
  const rounded = Math.round(level);
  if (rounded <= 0) {
    return "Unstarted";
  }
  const roman = TRACK_ROMAN_NUMERALS[rounded];
  return roman === undefined
    ? `Level ${INT_FORMAT.format(rounded)}`
    : `Level ${roman}`;
}

export function formatArenaLabel(id: string): string {
  return ARENA_LABELS[id] ?? formatTitleIdentifier(id);
}

export function formatCombatKind(kind: CombatKind): string {
  switch (kind) {
    case "pvp":
      return "PvP Kill";
    case "pve_kill":
      return "Mob Slain";
    case "pve_death":
      return "Killed by Mob";
    case "env_death":
      return "Environment";
  }
}

export function formatBounceCategory(category: BounceCategory): string {
  switch (category) {
    case "banned":
      return "Banned";
    case "allowlist":
      return "Allowlist";
    case "maintenance":
      return "Maintenance";
    case "full":
      return "Server Full";
    case "kicked":
      return "Kicked";
    case "other":
      return "Other";
  }
}

export function activityGroupLabel(group: ActivityGroup): string {
  switch (group) {
    case "regular":
      return "Regular";
    case "active":
      return "Active";
    case "irregular":
      return "Irregular";
    case "inactive":
      return "Inactive";
  }
}

export function activityGroupPillClass(group: ActivityGroup): string {
  switch (group) {
    case "regular":
      return "pill pill-regular";
    case "active":
      return "pill pill-active";
    case "irregular":
      return "pill pill-irregular";
    case "inactive":
      return "pill pill-inactive";
  }
}

export function formatTitleIdentifier(raw: string): string {
  return raw
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replaceAll(/\b[a-z]/gu, (ch) => ch.toUpperCase());
}

const AVATAR_PALETTES: readonly (readonly [string, string, string])[] = [
  ["#0d5c50", "#2dd4bf", "#d9fbee"],
  ["#1d4ed8", "#60a5fa", "#dbeafe"],
  ["#6d28d9", "#a78bfa", "#ede9fe"],
  ["#9a3412", "#fb923c", "#ffedd5"],
  ["#0f766e", "#34d399", "#d1fae5"],
  ["#854d0e", "#facc15", "#fef9c3"],
  ["#9f1239", "#fb7185", "#ffe4e6"],
  ["#1e3a8a", "#38bdf8", "#e0f2fe"],
];

export type AvatarDescriptor = {
  readonly bg: string;
  readonly primary: string;
  readonly highlight: string;
  readonly activePixels: readonly (readonly [number, number])[];
};

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (const ch of seed) {
    const code = ch.codePointAt(0) ?? 0;
    hash ^= code;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function buildAvatarDescriptor(seed: string): AvatarDescriptor {
  const hash = hashSeed(seed.toLowerCase());
  const palette = AVATAR_PALETTES[hash % AVATAR_PALETTES.length] ?? [
    "#0d5c50",
    "#2dd4bf",
    "#d9fbee",
  ];
  const pixels: [number, number][] = [];
  let bitCursor = hash ^ 2_779_096_410;

  for (let y = 1; y < 7; y += 1) {
    for (let x = 1; x < 4; x += 1) {
      const bit = bitCursor & 1;
      bitCursor = (bitCursor >>> 1) | ((bitCursor & 1) << 30);
      const isEyeSlot = y === 3 && x === 2;
      if (bit === 1 && !isEyeSlot) {
        pixels.push([x, y], [7 - x, y]);
      }
    }
  }

  return {
    bg: palette[0],
    primary: palette[1],
    highlight: palette[2],
    activePixels: pixels,
  };
}
