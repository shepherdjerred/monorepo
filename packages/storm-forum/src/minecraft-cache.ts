import { z } from "zod";
import stateCombinations from "#config/minecraft-status-states.json";
import {
  PublicPlayersSchema,
  PublicGameStatusSchema,
} from "./minecraft-query.ts";

const StateSchema = z.enum(["sleeping", "starting", "online", "unavailable"]);
const CacheStateCombinations = z
  .array(z.tuple([StateSchema, StateSchema, StateSchema]))
  .min(1)
  .parse(stateCombinations);
const EditionSchema = z
  .object({
    state: StateSchema,
    version: z.string().min(1).max(100).optional(),
    verifiedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
const HealthSchema = z
  .object({
    state: StateSchema,
    checkedAt: z.number().int().nonnegative(),
    java: EditionSchema,
    bedrock: EditionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !CacheStateCombinations.some(
        ([state, java, bedrock]) =>
          state === value.state &&
          java === value.java.state &&
          bedrock === value.bedrock.state,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Minecraft aggregate state does not match edition health",
      });
    }
    for (const edition of [value.java, value.bedrock]) {
      if (
        (edition.version === undefined) !==
          (edition.verifiedAt === undefined) ||
        (edition.state === "online" && edition.version === undefined)
      ) {
        context.addIssue({
          code: "custom",
          message: "Minecraft edition is missing its verified version",
        });
      }
    }
  });
export const MinecraftStatusSchema = HealthSchema.safeExtend({
  schemaVersion: z.literal(3),
  players: PublicPlayersSchema.optional(),
  games: z.array(PublicGameStatusSchema).max(1000).optional(),
}).superRefine((value, context) => {
  if (
    (value.java.state === "online") !== (value.players !== undefined) ||
    (value.java.state === "online") !== (value.games !== undefined) ||
    (value.players !== undefined &&
      (new Set(value.players.names).size !== value.players.names.length ||
        value.players.names.length > value.players.maximum)) ||
    value.games?.some(
      (game) => game.players > (value.players?.identities.length ?? 0),
    ) === true
  ) {
    context.addIssue({
      code: "custom",
      message: "Minecraft cache roster and games do not match Java health",
    });
  }
});
export type MinecraftStatus = z.infer<typeof MinecraftStatusSchema>;

const LegacyEditionCacheSchema = HealthSchema.safeExtend({
  schemaVersion: z.literal(2),
  players: z
    .object({
      maximum: PublicPlayersSchema.shape.maximum,
      names: PublicPlayersSchema.shape.names,
    })
    .strict()
    .optional(),
}).superRefine((value, context) => {
  if (
    (value.java.state === "online") !== (value.players !== undefined) ||
    (value.players !== undefined &&
      (new Set(value.players.names).size !== value.players.names.length ||
        value.players.names.length > value.players.maximum))
  ) {
    context.addIssue({
      code: "custom",
      message: "Invalid legacy Minecraft roster",
    });
  }
});
const LegacyCountCacheSchema = z
  .object({
    state: StateSchema,
    checkedAt: z.number().int().nonnegative(),
    online: z.number().int().nonnegative().optional(),
    maximum: z.number().int().nonnegative().optional(),
  })
  .strict();

export function parseMinecraftStatusCache(
  data: unknown,
): MinecraftStatus | undefined {
  const value = z
    .union([
      MinecraftStatusSchema,
      LegacyEditionCacheSchema,
      LegacyCountCacheSchema,
    ])
    .parse(data);
  if (!("schemaVersion" in value)) return undefined;
  if (value.schemaVersion === 3) return value;
  // Preserve verified versions, but require a fresh Query for identities and games.
  const java = {
    ...value.java,
    state:
      value.java.state === "online"
        ? ("unavailable" as const)
        : value.java.state,
  };
  return MinecraftStatusSchema.parse({
    schemaVersion: 3,
    state:
      value.state === "online" && value.bedrock.state !== "online"
        ? "unavailable"
        : value.state,
    checkedAt: value.checkedAt,
    java,
    bedrock: value.bedrock,
  });
}
