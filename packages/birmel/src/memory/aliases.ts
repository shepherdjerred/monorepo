import { z } from "zod";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import { DiscordIdSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { normalizeMemoryText } from "@shepherdjerred/birmel/memory/serialization.ts";

export const PERSONA_ALIAS_PREDICATE = "identity.alias";

const AliasLookupSchema = z.strictObject({
  guildId: DiscordIdSchema,
  personaId: z.string().min(1).max(200),
  at: z.date(),
});

export async function findActivePersonaAliases(
  client: PrismaClient,
  options: {
    guildId: string;
    personaId: string;
    at?: Date;
  },
): Promise<string[]> {
  const input = AliasLookupSchema.parse({
    guildId: options.guildId,
    personaId: options.personaId,
    at: options.at ?? new Date(),
  });
  const claims = await client.memoryClaim.findMany({
    where: {
      guildId: input.guildId,
      personaId: input.personaId,
      scope: "persona",
      predicate: PERSONA_ALIAS_PREDICATE,
      origin: "explicit",
      status: "active",
    },
    select: { value: true, validFrom: true, validUntil: true },
  });
  const aliases = new Map<string, string>();
  for (const claim of claims) {
    if (
      (claim.validFrom !== null && claim.validFrom > input.at) ||
      (claim.validUntil !== null && claim.validUntil < input.at)
    ) {
      continue;
    }
    aliases.set(normalizeMemoryText(claim.value), claim.value);
  }
  return [...aliases.values()].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

export async function listActivePersonaAliases(options: {
  guildId: string;
  personaId: string;
  at?: Date;
}): Promise<string[]> {
  return await findActivePersonaAliases(prisma, options);
}
