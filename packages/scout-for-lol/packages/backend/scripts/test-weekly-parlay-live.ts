import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  validateWeeklyParlayProposal,
  WeeklyParlaySubjectSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { generateWeeklyParlayProposal } from "#src/betting/weekly-parlay-model.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("test-weekly-parlay-live");
if (Bun.env["OPENROUTER_API_KEY"] === undefined) {
  throw new Error("OPENROUTER_API_KEY is required for test:weekly-parlay:live");
}

const subject = WeeklyParlaySubjectSchema.parse({
  key: "P1",
  playerId: 1,
  alias: "Weekly Test Player",
  discordId: DiscordAccountIdSchema.parse("160509172704739328"),
  accounts: [
    {
      puuid: LeaguePuuidSchema.parse("weekly-live".padEnd(78, "x")),
      trackingStartedAt: "2025-01-01T00:00:00.000Z",
    },
  ],
});
const champions = new Set(["Ahri", "Jinx", "Lee Sin", "Nautilus", "Ornn"]);
const roles = new Set([
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
] as const);
const generated = await generateWeeklyParlayProposal({
  periodKey: "2026-08-24",
  subjects: [subject],
  observedChampions: new Map([[subject.key, champions]]),
  observedRoles: new Map([[subject.key, roles]]),
  recentEligibleGames: new Map([[subject.key, 6]]),
  historyWindows: 30,
});
const issues = validateWeeklyParlayProposal({
  proposal: generated.proposal,
  subjects: [subject],
  observedChampions: new Map([[subject.key, champions]]),
  observedRoles: new Map([[subject.key, roles]]),
});
if (issues.length > 0) {
  throw new Error(
    `Weekly prompt failed semantic validation: ${issues.join("; ")}`,
  );
}
logger.info("Weekly parlay live prompt accepted", {
  model: generated.resolvedModel ?? generated.model,
  legs: generated.proposal.legs.length,
});
