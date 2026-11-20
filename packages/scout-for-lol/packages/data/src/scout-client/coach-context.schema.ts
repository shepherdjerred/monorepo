import { z } from "zod";

/**
 * The game state Scout Desktop may attach to an Explore turn.
 *
 * The language-neutral source of truth is `coach-context.schema.json`; the
 * shared accept and reject bodies live in `coach-context.fixtures.json`. The
 * Rust client holds the same fixtures to strict serde types in
 * `scout-client-core/src/coach_context.rs`, and
 * `coach-context.schema.test.ts` fails if this file and the JSON Schema drift.
 *
 * Content limit: nothing the player cannot see in their own client. No
 * section has a field for a Riot ID or summoner name, a skin, the enemy ward
 * score, a cooldown or summoner timer, or a map position, and every object is
 * strict, so none can be added by a client either. Whether a section may
 * reach the agent at all is the server's coach policy
 * (`backend/src/coach/context-policy.ts`), not this schema.
 */

const U8 = z.number().int().min(0).max(255);
const U32 = z.number().int().min(0).max(4_294_967_295);
const Name = z.string().min(1).max(64);
const Team = z.enum(["order", "chaos"]);
/** The two summoner spell names, never their cooldown state. */
const SummonerSpells = z.tuple([Name, Name]);
const Keystone = Name.nullable();

const AllySlotSchema = z.strictObject({
  cellId: U8,
  championId: U32,
  assignedRole: z.string().min(1).max(16).nullable(),
});

const EnemySlotSchema = z.strictObject({
  cellId: U8,
  championId: U32,
});

/** What the champion-select screen shows. Enemy summoners stay hidden. */
export const CoachChampSelectSchema = z.strictObject({
  phase: z.string().min(1).max(32).nullable(),
  localCellId: U8,
  myTeam: z.array(AllySlotSchema).max(5),
  theirTeam: z.array(EnemySlotSchema).max(5),
  myBans: z.array(U32).max(5),
  theirBans: z.array(U32).max(5),
});

const PregameParticipantSchema = z.strictObject({
  team: Team,
  isSelf: z.boolean(),
  champion: Name,
  summonerSpells: SummonerSpells,
  keystone: Keystone,
});

/** The loading screen. */
export const CoachPregameSchema = z.strictObject({
  game: z.strictObject({ mode: Name, map: Name }),
  participants: z.array(PregameParticipantSchema).max(16),
});

const OwnStatsSchema = z.strictObject({
  gold: U32,
  maxHealth: z.number(),
  health: z.number(),
  resource: Name,
  maxResource: z.number(),
  currentResource: z.number(),
  armor: z.number(),
  magicResist: z.number(),
  attackDamage: z.number(),
  abilityPower: z.number(),
  attackSpeed: z.number(),
  moveSpeed: z.number(),
  critChance: z.number(),
});

const LiveItemSchema = z.strictObject({
  itemId: U32,
  name: z.string().min(1).max(96),
  count: U8,
});

const LiveParticipantSchema = z.strictObject({
  team: Team,
  isSelf: z.boolean(),
  champion: Name,
  level: U8,
  kills: U32,
  deaths: U32,
  assists: U32,
  creepScore: U32,
  items: z.array(LiveItemSchema).max(7),
  summonerSpells: SummonerSpells,
  keystone: Keystone,
});

/** The newest game event by name and time; the players involved are not kept. */
const LiveEventSchema = z.strictObject({
  id: U32,
  kind: Name,
  timeSecs: z.number().min(0),
});

/** The allowlisted `LiveSnapshot`: the stats panel and the scoreboard. */
export const CoachLiveSchema = z.strictObject({
  game: z.strictObject({ mode: Name, map: Name, gameTimeSecs: U32 }),
  own: OwnStatsSchema,
  participants: z.array(LiveParticipantSchema).max(16),
  eventCount: U32,
  latestEvent: LiveEventSchema.nullable(),
});

/** The finished game, by Riot match ID only. */
export const CoachPostgameSchema = z.strictObject({
  matchId: z.string().regex(/^[A-Z0-9]{2,6}_\d{1,20}$/),
});

/**
 * The most bytes a context within these bounds can take as JSON: every list
 * full, every string at its limit in three-byte characters, every number at
 * its longest. `coach-context.schema.test.ts` builds that context.
 */
export const COACH_GAME_CONTEXT_MAX_BYTES = 72 * 1024;

export const COACH_CONTEXT_SECTIONS = [
  "champSelect",
  "pregame",
  "live",
  "postgame",
] as const;
export const CoachContextSectionSchema = z.enum(COACH_CONTEXT_SECTIONS);
export type CoachContextSection = z.infer<typeof CoachContextSectionSchema>;

export const CoachGameContextSchema = z
  .strictObject({
    champSelect: CoachChampSelectSchema.optional(),
    pregame: CoachPregameSchema.optional(),
    live: CoachLiveSchema.optional(),
    postgame: CoachPostgameSchema.optional(),
  })
  .refine(
    (context) =>
      COACH_CONTEXT_SECTIONS.some((section) => context[section] !== undefined),
    { message: "A game context carries at least one section." },
  );
export type CoachGameContext = z.infer<typeof CoachGameContextSchema>;
export type CoachLiveContext = z.infer<typeof CoachLiveSchema>;

/**
 * The turns Scout Desktop may ask for without the player asking: advice on a
 * pick or ban that changed, and the plan at the start of a game. Each names
 * the one section it may carry, and neither may carry `live`: Riot's policy
 * prohibits unprompted alerts from live state, so only a turn the player
 * started may. The server's gate (`backend/src/coach/context-policy.ts`)
 * enforces it; this table is the contract both ends share.
 */
export const COACH_APP_INITIATIONS = [
  "app_champ_select",
  "app_pregame",
] as const;
export const CoachAppInitiationSchema = z.enum(COACH_APP_INITIATIONS);
export type CoachAppInitiation = z.infer<typeof CoachAppInitiationSchema>;

export const COACH_APP_INITIATION_SECTION = {
  app_champ_select: "champSelect",
  app_pregame: "pregame",
} as const satisfies Record<CoachAppInitiation, CoachContextSection>;

/** Server-enforced ceiling of app-started turns per game key, by initiation. */
export const COACH_APP_TURN_LIMITS = {
  app_champ_select: 4,
  app_pregame: 1,
} as const satisfies Record<CoachAppInitiation, number>;

/** The client's opaque id for one champ select or one game; at most 64 chars. */
export const CoachGameKeySchema = z
  .string()
  .regex(/^[\w-]{1,64}$/, "a game key is 1 to 64 letters, digits, _ or -");

/**
 * `runs/start-app`: a turn Scout starts itself. It has no question (the
 * server words it) and no `live` section: a pick or ban change carries the
 * champion-select screen, the first moment of a game carries the loading
 * screen, and nothing else. `gameKey` is the client's opaque id for that
 * champ select or game; the server allows 4 champ-select turns and 1
 * pre-game turn per key.
 */
export const ScoutDesktopAppTurnRequestSchema = z
  .strictObject({
    conversationId: z.uuid().nullable(),
    initiation: CoachAppInitiationSchema,
    gameKey: CoachGameKeySchema,
    gameContext: CoachGameContextSchema,
  })
  .refine(
    (request) => {
      const allowed = COACH_APP_INITIATION_SECTION[request.initiation];
      return Object.keys(request.gameContext).every((key) => key === allowed);
    },
    {
      message:
        "An app-started turn carries only the section its initiation names, never live state.",
      path: ["gameContext"],
    },
  );
export type ScoutDesktopAppTurnRequest = z.infer<
  typeof ScoutDesktopAppTurnRequestSchema
>;
