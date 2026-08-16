#!/usr/bin/env bun

import { z } from "zod";
import { anonymizeCustomParticipant } from "#src/customs/anonymize.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("anonymize-customs-participant");

const ArgsSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  execute: z.boolean(),
});

function requiredValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${flag}`);
  }
  return value;
}

const args = Bun.argv.slice(2);
const input = ArgsSchema.parse({
  guildId: requiredValue(args, "--guild-id"),
  discordId: requiredValue(args, "--discord-id"),
  execute: args.includes("--execute"),
});

try {
  const report = await anonymizeCustomParticipant({ prisma, ...input });
  logger.info("Customs participant anonymization report", report);
  if (!input.execute) {
    logger.info(
      "Dry run only. Repeat with --execute after reviewing the counts.",
    );
  }
} finally {
  await prisma.$disconnect();
}
