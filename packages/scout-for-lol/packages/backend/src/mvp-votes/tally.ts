import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { LeaguePuuid, RiotTeamId } from "@scout-for-lol/data";
import { MVP_TALLY_EMPTY, MVP_TALLY_TITLE } from "#src/mvp-votes/copy.ts";
import {
  nomineeAt,
  teamLabel,
  type MatchMvpRoster,
} from "#src/mvp-votes/roster.ts";
import { groupMatchMvpVotesForTeam } from "#src/mvp-votes/vote-groups.ts";
import type { StoredMatchMvpVote } from "#src/mvp-votes/vote.ts";

/** Discord embed description limit, with a small buffer for formatting. */
const TALLY_DESCRIPTION_BUDGET = 3900;
const REASON_LINE_MAX = 80;
const DISPLAY_NAME_MAX = 80;
const CHAMPION_LABEL_MAX = 24;

export function emptyMvpTallyEmbed(): EmbedBuilder {
  return new EmbedBuilder({
    title: MVP_TALLY_TITLE,
    description: MVP_TALLY_EMPTY,
  });
}

function sanitizeTallyText(raw: string): string {
  const oneLine = raw
    .replaceAll(/[\r\n\u{2028}\u{2029}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return escapeMarkdown(oneLine, {
    heading: true,
    bulletedList: true,
    numberedList: true,
    maskedLink: true,
  })
    .replaceAll("@everyone", "@\u{200B}everyone")
    .replaceAll("@here", "@\u{200B}here")
    .replaceAll(/<@!?\d+>/gu, "[mention]");
}

export function displayNameFor(
  puuid: LeaguePuuid,
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): string {
  const alias = aliases.get(puuid);
  if (alias !== undefined && alias.trim().length > 0) {
    return truncate(sanitizeTallyText(alias), DISPLAY_NAME_MAX);
  }
  const participant = roster.participants.find(
    (entry) => entry.puuid === puuid,
  );
  if (participant === undefined) {
    throw new Error(
      `Match MVP tally asked to name ${puuid}, who is not on the frozen roster`,
    );
  }
  return truncate(sanitizeTallyText(participant.riotId), DISPLAY_NAME_MAX);
}

export function nomineeLabel(
  index: number,
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): string {
  const participant = nomineeAt(roster, index);
  const name = displayNameFor(participant.puuid, roster, aliases);
  const champion = truncate(
    sanitizeTallyText(participant.championName),
    CHAMPION_LABEL_MAX,
  );
  return `${name} (${champion})`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

type NomineeBucket = {
  nomineeIndex: number;
  count: number;
  reasons: { voterLabel: string; justification: string }[];
};

function bucketsForTeam(
  votes: readonly StoredMatchMvpVote[],
  teamId: RiotTeamId,
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): NomineeBucket[] {
  return groupMatchMvpVotesForTeam(votes, teamId, roster).map((group) => {
    const reasons: NomineeBucket["reasons"] = [];
    for (const vote of group.votes) {
      if (vote.justification !== null) {
        reasons.push({
          voterLabel: displayNameFor(vote.voterPuuid, roster, aliases),
          justification: sanitizeTallyText(vote.justification),
        });
      }
    }
    return {
      nomineeIndex: group.nomineeIndex,
      count: group.votes.length,
      reasons,
    };
  });
}

function renderSide(
  teamId: RiotTeamId,
  buckets: readonly NomineeBucket[],
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): string[] {
  if (buckets.length === 0) {
    return [];
  }
  const lines = [`**${teamLabel(teamId)} MVP**`];
  for (const bucket of buckets) {
    lines.push(
      `${nomineeLabel(bucket.nomineeIndex, roster, aliases)} · ${String(bucket.count)}`,
    );
    for (const reason of bucket.reasons) {
      lines.push(
        `  "${truncate(reason.justification, REASON_LINE_MAX)}" — ${reason.voterLabel}`,
      );
    }
  }
  return lines;
}

/**
 * Public board for the shared report message. Headings are Blue/Red by the
 * nominee's side; "our"/"my" would be false for half the room.
 */
export function formatMvpTallyDescription(
  votes: readonly StoredMatchMvpVote[],
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): string {
  if (votes.length === 0) {
    return MVP_TALLY_EMPTY;
  }
  const blue = renderSide(
    100,
    bucketsForTeam(votes, 100, roster, aliases),
    roster,
    aliases,
  );
  const red = renderSide(
    200,
    bucketsForTeam(votes, 200, roster, aliases),
    roster,
    aliases,
  );
  const sections = [
    ...blue,
    ...(blue.length > 0 && red.length > 0 ? [""] : []),
    ...red,
  ];
  return sections.length === 0 ? MVP_TALLY_EMPTY : fitTallyLines(sections);
}

function isReasonLine(line: string): boolean {
  return line.startsWith('  "');
}

function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function fitTallyLines(sections: readonly string[]): string {
  const detailed = joinLines(sections);
  if (detailed.length <= TALLY_DESCRIPTION_BUDGET) {
    return detailed;
  }
  const compact = sections.filter((line) => !isReasonLine(line));
  const compactText = joinLines(compact);
  if (compactText.length <= TALLY_DESCRIPTION_BUDGET) {
    return compact.length === sections.length ||
      compactText.length + 2 > TALLY_DESCRIPTION_BUDGET
      ? compactText
      : `${compactText}\n…`;
  }
  const kept: string[] = [];
  let used = 0;
  for (const line of compact) {
    const extra = kept.length === 0 ? line.length : line.length + 1;
    if (used + extra > TALLY_DESCRIPTION_BUDGET) {
      break;
    }
    kept.push(line);
    used += extra;
  }
  return joinLines(kept);
}

export function mvpTallyEmbed(input: {
  votes: readonly StoredMatchMvpVote[];
  roster: MatchMvpRoster;
  aliases: ReadonlyMap<LeaguePuuid, string>;
  footerText?: string | undefined;
}): EmbedBuilder {
  const embed = new EmbedBuilder({
    title: MVP_TALLY_TITLE,
    description: formatMvpTallyDescription(
      input.votes,
      input.roster,
      input.aliases,
    ),
  });
  return input.footerText !== undefined && input.footerText.length > 0
    ? embed.setFooter({ text: input.footerText })
    : embed;
}
