import { z } from "zod";
import type { ExploreScenarioSurface } from "@scout-for-lol/data";
import { judgeEvidenceFromTrace } from "#src/explore/replay/judge.ts";
import type { ScenarioWorld } from "#src/explore/scenarios/world.ts";

/**
 * Judging a scenario turn against its rubric.
 *
 * The replay judge asks general questions of any answer — grounded, honest
 * about coverage. A scenario knows exactly what a good answer must do here:
 * "names Omz as the asker", "does not invent a settings page". The judge is
 * asked about those criteria one by one and returns a closed verdict for
 * each; whether the turn passes is decided here, in code, not by the model.
 *
 * The judge sees the seeded world — who is asking, what the server holds —
 * because most criteria are claims about it. Without it, "identifies the
 * asker as Omz" cannot be checked at all.
 */

export const ScenarioJudgementSchema = z
  .strictObject({
    criteria: z
      .array(
        z.strictObject({
          index: z.number().int().nonnegative(),
          verdict: z.enum(["met", "not_met"]),
          reason: z.string().max(400),
        }),
      )
      .max(6),
  })
  .strict();

export type ScenarioJudgement = z.infer<typeof ScenarioJudgementSchema>;

export type ScenarioRubricResult = {
  readonly criterion: string;
  readonly met: boolean;
  readonly reason: string;
};

/**
 * One result per criterion, in rubric order.
 *
 * A criterion the judge skipped counts as not met: a verdict nobody gave is
 * not a pass, and silently dropping it would let a lazy judge raise scores.
 */
export function rubricResults(
  rubric: readonly string[],
  judgement: ScenarioJudgement,
): readonly ScenarioRubricResult[] {
  return rubric.map((criterion, index) => {
    const verdict = judgement.criteria.find((entry) => entry.index === index);
    return verdict === undefined
      ? { criterion, met: false, reason: "The judge gave no verdict." }
      : { criterion, met: verdict.verdict === "met", reason: verdict.reason };
  });
}

export function scenarioJudgeSystemPrompt(): string {
  return [
    "You grade one answer from Explore, Scout's League of Legends assistant, against a fixed list of criteria.",
    "You are given the seeded world the answer was produced in: the server, who is asking, which players and reports exist, and what the tools returned.",
    "For each criterion, answer `met` only if the answer clearly satisfies it. Partial, implied or hedged satisfaction is `not_met`.",
    "Judge only the criteria. Do not reward style, length or politeness, and do not penalise anything a criterion does not mention.",
    "A criterion about facts (a name, a game, a count) is met only if the fact is correct for the seeded world and the tool results.",
    "Return one verdict per criterion, using its index, with a one-sentence reason.",
  ].join("\n");
}

function worldSummary(world: ScenarioWorld): string {
  const channel = (id: string) =>
    world.channels.find((candidate) => candidate.id === id)?.name ?? id;
  const players =
    world.players.length === 0
      ? "none"
      : world.players
          .map((player) =>
            [
              `${player.alias} (Riot ID ${player.account.gameName}#${player.account.tagLine}, ${player.account.games.toString()} recorded games`,
              player.discordId === world.asker.id
                ? ", linked to the asker"
                : player.discordId === null
                  ? ""
                  : ", linked to a member",
              player.feedChannelIds.length === 0
                ? ")"
                : `, feed in ${player.feedChannelIds.map((id) => `#${channel(id)}`).join(", ")})`,
            ].join(""),
          )
          .join("; ");
  return [
    `Surface: ${world.surface}`,
    `Server: ${world.guildName}`,
    `Asker: ${world.asker.displayName} (@${world.asker.username})`,
    `Channels: ${world.channels.map((entry) => `#${entry.name}`).join(", ")}`,
    `Other members: ${
      world.members
        .filter((member) => member.id !== world.asker.id)
        .map((member) => `@${member.username}`)
        .join(", ") || "none"
    }`,
    `Tracked players: ${players}`,
  ].join("\n");
}

export function scenarioJudgeUserPrompt(input: {
  readonly world: ScenarioWorld;
  readonly surface: ExploreScenarioSurface;
  readonly conversation: readonly {
    readonly question: string;
    readonly answer: string;
  }[];
  readonly question: string;
  readonly answer: string | null;
  readonly followUps: readonly string[];
  readonly trace: Parameters<typeof judgeEvidenceFromTrace>[0];
  readonly payloads: Parameters<typeof judgeEvidenceFromTrace>[1];
  readonly rubric: readonly string[];
}): string {
  const evidence = judgeEvidenceFromTrace(input.trace, input.payloads);
  const toolNames = [...new Set(input.trace.map((entry) => entry.toolName))];
  return [
    "## Seeded world",
    worldSummary(input.world),
    "",
    "## Earlier turns",
    input.conversation.length === 0
      ? "(none)"
      : input.conversation
          .map((turn) => `User: ${turn.question}\nExplore: ${turn.answer}`)
          .join("\n\n"),
    "",
    "## This turn",
    `User: ${input.question}`,
    `Explore: ${input.answer ?? "(no answer — the turn failed)"}`,
    input.followUps.length === 0
      ? "Suggested follow-ups: none"
      : `Suggested follow-ups: ${input.followUps.map((chip) => JSON.stringify(chip)).join(", ")}`,
    "",
    "## Tools this turn",
    toolNames.length === 0 ? "(none)" : toolNames.join(", "),
    ...evidence.queries.map(
      (query, index) =>
        `Query ${(index + 1).toString()} (${query.scope ?? "unknown scope"}, ${query.rowsReturned?.toString() ?? "?"} rows): ${query.queryText ?? "(text unavailable)"}`,
    ),
    ...evidence.toolResults.map(
      (result) => `${result.toolName} returned: ${result.summary}`,
    ),
    "",
    "## Criteria",
    ...input.rubric.map(
      (criterion, index) => `${index.toString()}. ${criterion}`,
    ),
  ].join("\n");
}
