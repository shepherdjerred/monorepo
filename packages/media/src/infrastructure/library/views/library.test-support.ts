import type { MediaActor } from "#application/auth.ts";
import type { Availability } from "#shared/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";

const DAY = 86_400_000;

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

/** A household member whose Plex access to the named sections was just verified. */
export async function libraryMember(
  db: Database,
  access: { sections: string[]; role?: "owner" | "member" },
): Promise<MediaActor> {
  const role = access.role ?? "member";
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Library reader",
      role,
    },
  });
  await db.plexIdentityMapping.create({
    data: {
      userId: user.id,
      serverMachineId: "fixture-server",
      serverAccountId: user.plexAccountId,
      kind: "account",
      permittedSectionIds: access.sections,
      permittedMediaKinds: ["movie", "series"],
      verifiedAt: new Date(),
    },
  });
  return { ...user, role };
}

type File = {
  /** When Media first recorded the file. */
  recordedAt: Date;
  /** False for a file an upgrade or a removal has since replaced. */
  current: boolean;
  /** False for a file in a registered external library. */
  owned?: boolean;
};
type State = {
  availability?: Availability;
  keep?: boolean;
  /** Members with a standing request. */
  followers?: readonly string[];
  /** Members who asked once and have since finished. */
  finished?: readonly string[];
  /** Members whose request keeps the title indefinitely. */
  keepers?: readonly string[];
  files?: readonly File[];
  removal?: { state: string; graceUntil: Date | null };
};
type Title = State & {
  kind?: "movie" | "series";
  /** The Plex library section the title lives in, when not its kind's default. */
  section?: string;
};

async function seed(db: Database, mediaId: string, state: State) {
  await createTestDefaultTarget(db, mediaId, {
    libraryKeep: state.keep ?? false,
  });
  const claims = [
    ...(state.followers ?? []).map((userId) => ({ userId })),
    ...(state.finished ?? []).map((userId) => ({
      userId,
      interestState: "finished" as const,
    })),
    ...(state.keepers ?? []).map((userId) => ({
      userId,
      keepingPolicy: "keep" as const,
    })),
  ];
  for (const claim of claims)
    await db.mediaRequest.create({ data: { mediaId, ...claim } });
  for (const file of state.files ?? [])
    await db.libraryAsset.create({
      data: {
        path: `/data/library-fixture/${crypto.randomUUID()}.mkv`,
        sizeBytes: 10n,
        properties: {},
        state: file.current ? "published" : "superseded",
        owned: file.owned ?? true,
        ownershipEpoch: file.owned === false ? -1 : 0,
        createdAt: file.recordedAt,
        coverage: { create: { mediaId, current: file.current } },
      },
    });
  if (state.removal !== undefined)
    await db.retentionDecision.create({
      data: {
        mediaId,
        generation: 1,
        evidence: { recoveryEpoch: 0 },
        ...state.removal,
      },
    });
}

/** A movie or series row with the library state a test names, and nothing else. */
export async function libraryTitle(db: Database, title: string, row: Title) {
  const { kind = "movie", section, ...state } = row;
  const media = await db.mediaItem.create({
    data: {
      kind,
      title,
      availability: state.availability ?? "wanted",
      externalIds: section === undefined ? {} : { plexSectionId: section },
    },
  });
  await seed(db, media.id, state);
  return media;
}

/** An episode directly under its series, or under a season when one is given. */
export async function libraryEpisode(
  db: Database,
  parentId: string,
  episode: State & { season: number; number: number },
) {
  const { season, number, ...state } = episode;
  const media = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: `Episode ${String(season)}x${String(number)}`,
      parentId,
      seasonNumber: season,
      episodeNumber: number,
      availability: state.availability ?? "wanted",
    },
  });
  await seed(db, media.id, state);
  return media;
}

const inDays = (days: number) => new Date(Date.now() + days * DAY);
const playable = (recordedDaysAgo: number, owned = true) => ({
  recordedAt: daysAgo(recordedDaysAgo),
  current: true,
  owned,
});

/**
 * One household's library, each title in a different state. Titles are named
 * `<tag> <letter>` so a query for the tag lists exactly these, A to Z.
 *
 * | | Title | Policy | Plays | Leaving |
 * |-|-|-|-|-|
 * | A | movie, library Keep | keep | yes, 10 days | |
 * | B | movie the housemate keeps | keep | no | |
 * | C | movie the reader follows | temporary | no | |
 * | D | movie the housemate follows | temporary | yes, 3 days | |
 * | E | movie the reader finished | unclassified | yes, 20 days | |
 * | F | movie the housemate finished | unclassified | yes, 15 days | in 3 days |
 * | G | the same, already quarantined | unclassified | no | (left) |
 * | H | kept movie in section 9 | keep | yes, 12 days | in 1 day |
 * | I | series the reader follows, 1 of 2 episodes and a special | temporary | yes, 8 days | |
 * | J | series the housemate finished, 3 of 3 | unclassified | yes, 4 days | in 2 days |
 * | K | kept series with only a special | keep | no | |
 * | L | kept series with no episodes | keep | no | |
 * | M | kept series held in an external library | keep | unknown, 2 days | |
 * | N | kept movie with an unproved external file | keep | no, 1 day | |
 */
export async function libraryHousehold(db: Database, tag: string) {
  const reader = await libraryMember(db, { sections: ["1", "2"] });
  const housemate = await libraryMember(db, { sections: ["1", "2"] });
  const owner = await libraryMember(db, {
    sections: ["1", "2", "9"],
    role: "owner",
  });
  const add = (letter: string, row: Title) =>
    libraryTitle(db, `${tag} ${letter}`, row);
  const playing = { availability: "available" } as const;
  const a = await add("A", { ...playing, keep: true, files: [playable(10)] });
  const b = await add("B", { keepers: [housemate.id] });
  const c = await add("C", {
    availability: "downloading",
    followers: [reader.id],
  });
  const d = await add("D", {
    ...playing,
    followers: [housemate.id],
    files: [playable(3)],
  });
  const e = await add("E", {
    ...playing,
    finished: [reader.id],
    files: [playable(20)],
  });
  const movieLeaves = inDays(3);
  const f = await add("F", {
    ...playing,
    finished: [housemate.id],
    files: [playable(15)],
    removal: { state: "grace_period", graceUntil: movieLeaves },
  });
  const g = await add("G", {
    availability: "quarantined",
    finished: [housemate.id],
    removal: { state: "quarantined", graceUntil: inDays(-1) },
  });
  const h = await add("H", {
    ...playing,
    section: "9",
    keep: true,
    files: [playable(12)],
    removal: { state: "grace_period", graceUntil: inDays(1) },
  });
  const i = await add("I", { kind: "series", followers: [reader.id] });
  const firstSeason = await librarySeason(db, i.id, 1);
  await libraryEpisode(db, i.id, {
    ...playing,
    season: 1,
    number: 1,
    files: [playable(8)],
  });
  await libraryEpisode(db, firstSeason.id, { season: 1, number: 2 });
  await libraryEpisode(db, i.id, { ...playing, season: 0, number: 1 });
  const j = await add("J", { kind: "series", finished: [housemate.id] });
  const leavingSeason = await librarySeason(db, j.id, 1);
  const soonest = inDays(2);
  const leaving = [
    {
      parentId: j.id,
      recorded: 7,
      removal: { state: "warning_pending", graceUntil: null },
    },
    {
      parentId: leavingSeason.id,
      recorded: 6,
      removal: { state: "grace_period", graceUntil: inDays(5) },
    },
    {
      parentId: leavingSeason.id,
      recorded: 4,
      removal: { state: "grace_period", graceUntil: soonest },
    },
  ];
  for (const [index, { parentId, recorded, removal }] of leaving.entries())
    await libraryEpisode(db, parentId, {
      ...playing,
      season: 1,
      number: index + 1,
      files: [playable(recorded)],
      removal,
    });
  const k = await add("K", { kind: "series", keep: true });
  await libraryEpisode(db, k.id, { ...playing, season: 0, number: 1 });
  const l = await add("L", { kind: "series", keep: true });
  const m = await add("M", { kind: "series", keep: true });
  await libraryEpisode(db, m.id, {
    season: 1,
    number: 1,
    files: [playable(2, false)],
  });
  const n = await add("N", { keep: true, files: [playable(1, false)] });
  return {
    reader,
    housemate,
    owner,
    title: { a, b, c, d, e, f, g, h, i, j, k, l, m, n },
    leavesAt: { f: movieLeaves, j: soonest },
  };
}

export async function librarySeason(
  db: Database,
  seriesId: string,
  seasonNumber: number,
) {
  return db.mediaItem.create({
    data: {
      kind: "season",
      title: `Season ${String(seasonNumber)}`,
      parentId: seriesId,
      seasonNumber,
    },
  });
}
