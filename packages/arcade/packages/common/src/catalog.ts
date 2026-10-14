import { z } from "zod";

export const GameIdSchema = z.enum([
  "mk64",
  "emerald",
  "mkwii",
  "melee",
  "brawl",
]);
export type GameId = z.infer<typeof GameIdSchema>;

export type GameDefinition = {
  readonly id: GameId;
  readonly title: string;
  readonly family: "racing" | "pokemon" | "fighting";
  readonly runtime: "native" | "wasm" | "dolphin";
  readonly input: "n64" | "shared-gba" | "gamecube";
  readonly heavy: boolean;
  readonly seats: number;
};

export const games = {
  mk64: {
    id: "mk64",
    title: "Mario Kart 64",
    family: "racing",
    runtime: "native",
    input: "n64",
    heavy: false,
    seats: 4,
  },
  emerald: {
    id: "emerald",
    title: "Pokémon Emerald",
    family: "pokemon",
    runtime: "wasm",
    input: "shared-gba",
    heavy: false,
    seats: 0,
  },
  mkwii: {
    id: "mkwii",
    title: "Mario Kart Wii",
    family: "racing",
    runtime: "wasm",
    input: "gamecube",
    heavy: true,
    seats: 4,
  },
  melee: {
    id: "melee",
    title: "Super Smash Bros. Melee",
    family: "fighting",
    runtime: "wasm",
    input: "gamecube",
    heavy: true,
    seats: 4,
  },
  brawl: {
    id: "brawl",
    title: "Super Smash Bros. Brawl",
    family: "fighting",
    runtime: "dolphin",
    input: "gamecube",
    heavy: true,
    seats: 4,
  },
} as const satisfies Record<GameId, GameDefinition>;

export const DiscordIdSchema = z.string().regex(/^\d{1,20}$/);
export const PlayerSchema = z.strictObject({
  discordId: DiscordIdSchema,
  name: z.string().min(1),
  avatarUrl: z.string().nullable(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const SessionViewSchema = z.strictObject({
  id: z.uuid(),
  gameId: GameIdSchema,
  guildId: DiscordIdSchema,
  voiceChannelId: DiscordIdSchema,
  startedByUserId: DiscordIdSchema,
  startedAt: z.iso.datetime(),
  phase: z.enum(["starting", "running", "stopping", "failed"]),
});
export type SessionView = z.infer<typeof SessionViewSchema>;
