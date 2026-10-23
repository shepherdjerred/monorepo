/**
 * The archery report card's logic: reads a match recording's rows and judges
 * each ranged combatant's shooting. `archery.ts` is the command around it.
 *
 * A recording (`*.rwfrec.gz`, tab-separated) gives everything needed:
 * `R pseudonym team kit bot` for who played what, `J tick shooter kind ...`
 * for each arrow a bow or crossbow loosed, `E tick hit attacker
 * victim;class;cause;damage` for damage that landed between members,
 * `E tick died victim ...` for deaths and `X tick ...` for the end.
 *
 * Coverage: J rows are written for bow and crossbow arrows (the server's
 * bow-shot event, and a bot's direct bow shot), not for thrown tridents, so a
 * trident kit's shots read 0 and its hits still count. Recordings written
 * before hit events existed carry no `hit` row; their hits are unknown, not 0.
 */
import { z } from "zod";
import rangedKitsWire from "#ranged-kits-wire";

/**
 * Shots per minute alive an Infinity-bow bot must loose at least.
 *
 * Chosen from this report run over production's recordings of 2026-10-22
 * and two local frostline showcases (`bots:match`, 16 bots). In production,
 * human lives on Infinity bows (6 lives, 2 players) loosed 7.0 to 19.3 shots
 * a minute alive, median 15, 14.9 over all 17 minutes; production's
 * Infinity-bow bots loosed 0.4 (62 shots in 177 minutes). Locally, the new archer build's 10 bow bots loosed 5.3 a
 * minute (judged bots 1.9 to 15.6, median 4) and main's 8 loosed 1.0 (none
 * above 1.5). Four a minute, an arrow every 15 s, is under half the slowest
 * human life, fails every archer on main and about half on the new build.
 */
export const MIN_SHOTS_PER_MINUTE = 4;

/**
 * The share of shots that must land on an enemy.
 *
 * Production recordings have no hit rows yet, so humans' accuracy is
 * bounded from their kills: 16 projectile kills from 260 bow shots, 6% of
 * shots, is a hard floor (each kill takes at least one hit), and a kill on
 * an armoured 20-health target takes two to four arrows, putting humans near
 * 12% to 25%. Bots on the new build killed with 4% of their shots. Fifteen
 * percent sits inside the human range; revisit it once production recordings
 * carry hit rows and give humans' measured accuracy.
 */
export const MIN_ACCURACY = 0.15;

/** Projectile hits on an enemy an Infinity-bow bot must land in a match. */
export const MIN_HITS = 1;

/** A life shorter than this is too short to judge, and is reported only. */
export const MIN_JUDGED_SECONDS = 60;

/** Server ticks per second; recording ticks count from the match going live. */
const TICKS_PER_SECOND = 20;

/** Projectile kinds that a `J` row counts as a ranged shot. */
const SHOT_KINDS = new Set(["arrow", "spectral_arrow", "trident"]);

const RangedKit = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  weapon: z.enum(["bow", "crossbow", "trident"]),
  ammo: z.enum(["infinite", "finite", "returning"]),
  arrows: z.number().int().nonnegative(),
});
export type RangedKit = z.infer<typeof RangedKit>;

/**
 * The ranged kits as the plugin's kit book defines them (exported by
 * `RangedKitsTest` to `rwf-ranged-kits.json`), by kit id.
 */
export const RANGED_KITS: ReadonlyMap<string, RangedKit> = new Map(
  z
    .strictObject({ kits: z.array(RangedKit).nonempty() })
    .parse(rangedKitsWire)
    .kits.map((kit) => [kit.id, kit]),
);

const Tick = z.string().regex(/^\d+$/u).transform(Number);

/** One member of the recorded match. */
export type Member = {
  pseudonym: string;
  team: string;
  kit: string;
  bot: boolean;
};

/** What a recording says about who fought and how. */
export type Match = {
  id: string;
  map: string;
  members: Map<string, Member>;
  /** Ticks of each member's shots. */
  shots: Map<string, number[]>;
  /** Each landed hit: who, on whom, its class (`projectile`, `melee`, `other`). */
  hits: { tick: number; attacker: string; victim: string; type: string }[];
  /** The tick each member died, if they did. */
  deaths: Map<string, number>;
  /** Whether a death was credited to a killer: a credited kill always leaves a hit row. */
  creditedKills: number;
  /** The last tick: the end row's, or the last row seen in an unterminated recording. */
  endTick: number;
  /** Whether the recording ended normally. */
  ended: boolean;
};

const Pseudonym = z.string().min(1);

const HeaderRow = z
  .tuple([
    z.literal("H"),
    z.enum(["2", "3", "4"]),
    z.string().min(1),
    z.string(),
  ])
  .rest(z.string());
const MemberRow = z.tuple([
  z.literal("R"),
  Pseudonym,
  z.string().min(1),
  z.string().min(1),
  z.enum(["true", "false"]),
]);
const ShotRow = z
  .tuple([z.literal("J"), Tick, Pseudonym, z.string().min(1)])
  .rest(z.string());
const EventRow = z.tuple([
  z.literal("E"),
  Tick,
  z.string().min(1),
  z.string().min(1),
  z.string(),
]);
const HitDetail = z.tuple([
  Pseudonym,
  z.enum(["projectile", "melee", "other"]),
  z.string().min(1),
  z.string().regex(/^-?\d+\.\d{2}$/u),
]);
const EndRow = z.tuple([z.literal("X"), Tick]).rest(z.string());

function readHeader(match: Match, fields: string[]) {
  const header = HeaderRow.parse(fields);
  match.id = header[2];
  match.map = header[3];
}

function readMember(match: Match, fields: string[]) {
  const [, pseudonym, team, kit, bot] = MemberRow.parse(fields);
  match.members.set(pseudonym, { pseudonym, team, kit, bot: bot === "true" });
}

function readShot(match: Match, fields: string[]) {
  const [, tick, shooter, kind] = ShotRow.parse(fields);
  match.endTick = Math.max(match.endTick, tick);
  if (!SHOT_KINDS.has(kind)) return;
  const list = match.shots.get(shooter) ?? [];
  list.push(tick);
  match.shots.set(shooter, list);
}

function readEvent(match: Match, fields: string[]) {
  const [, tick, kind, subject, detail] = EventRow.parse(fields);
  match.endTick = Math.max(match.endTick, tick);
  if (kind === "hit") {
    const [victim, type] = HitDetail.parse(detail.split(";"));
    match.hits.push({ tick, attacker: subject, victim, type });
  } else if (kind === "died" && !match.deaths.has(subject)) {
    match.deaths.set(subject, tick);
    // The detail is "<killer> <cause>", with "-" when nobody was credited.
    if (!detail.startsWith("- ")) match.creditedKills++;
  }
}

function readEnd(match: Match, fields: string[]) {
  const [, tick] = EndRow.parse(fields);
  match.endTick = Math.max(match.endTick, tick);
  match.ended = true;
}

const READERS = new Map<string, (match: Match, fields: string[]) => void>([
  ["H", readHeader],
  ["R", readMember],
  ["J", readShot],
  ["E", readEvent],
  ["X", readEnd],
]);

/** Rows with no tick in their second field. */
const UNTIMED = new Set(["H", "R", "P"]);

/**
 * Reads a recording's rows. Rows the report has no use for only move the
 * last tick on, so an unterminated recording ends at its last row.
 */
export function readMatch(lines: string[]): Match {
  const match: Match = {
    id: "",
    map: "",
    members: new Map(),
    shots: new Map(),
    hits: [],
    deaths: new Map(),
    creditedKills: 0,
    endTick: 0,
    ended: false,
  };
  for (const line of lines) {
    if (line === "") continue;
    const fields = line.split("\t");
    const tag = fields[0] ?? "";
    const reader = READERS.get(tag);
    if (reader !== undefined) {
      reader(match, fields);
    } else if (!UNTIMED.has(tag)) {
      match.endTick = Math.max(match.endTick, Tick.parse(fields[1]));
    }
  }
  if (match.id === "") throw new Error("the recording has no header row");
  return match;
}

/** Whether `match` records hits: it has a hit row, or nobody was credited with a kill. */
export function recordsHits(match: Match): boolean {
  return match.hits.length > 0 || match.creditedKills === 0;
}

/** Why a judged archer failed the bar. */
export type Failure = "no-hit" | "slow" | "inaccurate";

/** One ranged member's card. */
export type Card = {
  match: string;
  pseudonym: string;
  team: string;
  kit: RangedKit;
  bot: boolean;
  secondsAlive: number;
  died: boolean;
  shots: number;
  shotsPerMinute: number;
  /** Projectile hits on enemies; undefined when the recording predates hit rows. */
  hits: number | undefined;
  /** Hits per shot; undefined without shots or without hit rows. */
  accuracy: number | undefined;
  /**
   * `PASS`/`FAIL` for a bot on an Infinity bow alive long enough; `UNKNOWN`
   * when its hits were not recorded; `-` when the bar does not apply.
   */
  verdict: "PASS" | "FAIL" | "UNKNOWN" | "-";
  failures: Failure[];
};

/** The member's projectile hits on members of another team. */
function enemyHits(match: Match, member: Member): number {
  return match.hits.filter((hit) => {
    const victim = match.members.get(hit.victim);
    return (
      hit.attacker === member.pseudonym &&
      hit.type === "projectile" &&
      victim !== undefined &&
      victim.team !== member.team
    );
  }).length;
}

/** The bar's failures for a judged card. */
function failuresOf(
  shotsPerMinute: number,
  hits: number | undefined,
  accuracy: number | undefined,
): Failure[] {
  const failures: Failure[] = [];
  if (hits !== undefined && hits < MIN_HITS) failures.push("no-hit");
  if (shotsPerMinute < MIN_SHOTS_PER_MINUTE) failures.push("slow");
  if (hits !== undefined && (accuracy === undefined || accuracy < MIN_ACCURACY))
    failures.push("inaccurate");
  return failures;
}

function cardOf(
  match: Match,
  member: Member,
  kit: RangedKit,
  hitsKnown: boolean,
): Card {
  const death = match.deaths.get(member.pseudonym);
  const secondsAlive = (death ?? match.endTick) / TICKS_PER_SECOND;
  const shots = match.shots.get(member.pseudonym)?.length ?? 0;
  const shotsPerMinute = secondsAlive > 0 ? (shots * 60) / secondsAlive : 0;
  const hits = hitsKnown ? enemyHits(match, member) : undefined;
  const accuracy = hits === undefined || shots === 0 ? undefined : hits / shots;
  const judged =
    member.bot && kit.ammo === "infinite" && secondsAlive >= MIN_JUDGED_SECONDS;
  const failures = judged ? failuresOf(shotsPerMinute, hits, accuracy) : [];
  let verdict: Card["verdict"] = "-";
  if (failures.length > 0) verdict = "FAIL";
  else if (judged) verdict = hits === undefined ? "UNKNOWN" : "PASS";
  return {
    match: match.id,
    pseudonym: member.pseudonym,
    team: member.team,
    kit,
    bot: member.bot,
    secondsAlive,
    died: death !== undefined,
    shots,
    shotsPerMinute,
    hits,
    accuracy,
    verdict,
    failures,
  };
}

/** Every ranged member's card in `match`, judged against the bar. */
export function cards(
  match: Match,
  kits: ReadonlyMap<string, RangedKit> = RANGED_KITS,
): Card[] {
  const hitsKnown = recordsHits(match);
  return [...match.members.values()]
    .flatMap((member) => {
      const kit = kits.get(member.kit);
      return kit === undefined ? [] : [cardOf(match, member, kit, hitsKnown)];
    })
    .toSorted(
      (a, b) =>
        a.team.localeCompare(b.team) ||
        a.kit.id.localeCompare(b.kit.id) ||
        a.pseudonym.localeCompare(b.pseudonym),
    );
}

/** Shots, hits and time alive summed over a group of cards. */
export type Totals = {
  members: number;
  judged: number;
  passed: number;
  failed: number;
  unknown: number;
  shots: number;
  /** Undefined when any card's hits are unknown. */
  hits: number | undefined;
  minutesAlive: number;
  shotsPerMinute: number;
  accuracy: number | undefined;
};

/** Sums `list`. */
export function totals(list: Card[]): Totals {
  const shots = list.reduce((sum, card) => sum + card.shots, 0);
  const minutesAlive = list.reduce(
    (sum, card) => sum + card.secondsAlive / 60,
    0,
  );
  const hits = list.some((card) => card.hits === undefined)
    ? undefined
    : list.reduce((sum, card) => sum + (card.hits ?? 0), 0);
  return {
    members: list.length,
    judged: list.filter((card) => card.verdict !== "-").length,
    passed: list.filter((card) => card.verdict === "PASS").length,
    failed: list.filter((card) => card.verdict === "FAIL").length,
    unknown: list.filter((card) => card.verdict === "UNKNOWN").length,
    shots,
    hits,
    minutesAlive,
    shotsPerMinute: minutesAlive > 0 ? shots / minutesAlive : 0,
    accuracy: hits === undefined || shots === 0 ? undefined : hits / shots,
  };
}
