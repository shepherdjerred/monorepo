import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  validateWeeklyParlayProposal,
  WeeklyParlaySubjectSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { generateWeeklyParlayProposals } from "#src/betting/weekly-parlay-model.ts";
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
const championShortlist = ["Ahri", "Jinx", "Lee Sin", "Nautilus", "Ornn"].map(
  (champion, index) => ({
    champion,
    windowsPlayed: 8 - index,
    gamesPlayed: 12 - index,
    wins: 6 - index,
    bestKills: 12 - index,
    bestAssists: 18 - index,
    bestChampionDamage: 30_000 - index * 1000,
    bestVisionScore: 50 - index,
  }),
);
const generated = await generateWeeklyParlayProposals({
  periodKey: "2026-08-24",
  subjects: [subject],
  championShortlists: new Map([[subject.key, championShortlist]]),
  historyWindows: 30,
});
const issues = generated.proposals.flatMap((proposal) =>
  validateWeeklyParlayProposal({
    proposal,
    subjects: [subject],
    eligibleChampions: new Map([
      [subject.key, new Set(championShortlist.map((entry) => entry.champion))],
    ]),
  }),
);
if (issues.length > 0) {
  throw new Error(
    `Weekly prompt failed semantic validation: ${issues.join("; ")}`,
  );
}
logger.info("Weekly parlay live prompt accepted", {
  model: generated.resolvedModel ?? generated.model,
  proposals: generated.proposals.length,
  legs: generated.proposals.map((proposal) => proposal.legs.length),
});
process.exit(0);
