import { z } from "zod";
import { anonymizeCustomParticipantFromStrings } from "#src/customs/anonymize.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("anonymize-customs-participant");

const ArgumentsSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  operatorId: z.string().min(1),
  confirm: z.literal(true),
});

function parseArguments(args: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(
        "Usage: --guild-id ID --discord-id ID --operator-id ID --confirm yes",
      );
    }
    values.set(key, value);
  }
  return ArgumentsSchema.parse({
    guildId: values.get("--guild-id"),
    discordId: values.get("--discord-id"),
    operatorId: values.get("--operator-id"),
    confirm: values.get("--confirm") === "yes",
  });
}

const input = parseArguments(Bun.argv.slice(2));
try {
  const result = await anonymizeCustomParticipantFromStrings(input);
  logger.info("Anonymized Customs participant", result);
} finally {
  await prisma.$disconnect();
}
