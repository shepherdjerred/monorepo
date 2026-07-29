import { z } from "zod";
import {
  classifyExceptionalPerformance,
  resolveQueueTypeFromGame,
} from "@scout-for-lol/data";

import { argumentValue } from "#lib/cli.ts";
import {
  BETA_CORPUS_BUCKET,
  BetaCorpus,
  defaultBetaCorpusPath,
} from "#materialization/beta-corpus.ts";
import {
  createS3Client,
  fetchRawMatch,
  listCandidateMatchKeys,
} from "#materialization/s3-source.ts";

const OptionsSchema = z.strictObject({
  corpusPath: z.string().min(1),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  prefix: z.string().regex(/^games\/\d{4}(\/\d{2}){0,2}\/?$/),
});

const options = OptionsSchema.parse({
  corpusPath: argumentValue("--corpus") ?? defaultBetaCorpusPath(),
  limit: argumentValue("--limit"),
  prefix: argumentValue("--prefix"),
});
const client = createS3Client();
const corpus = new BetaCorpus(options.corpusPath);
try {
  const matchKeys = await listCandidateMatchKeys(
    client,
    BETA_CORPUS_BUCKET,
    options.prefix,
  );
  const candidates = [];
  for (const matchKey of matchKeys.slice(-options.limit)) {
    const match = await fetchRawMatch(client, BETA_CORPUS_BUCKET, matchKey);
    const trackedProfiles = corpus.profilesForMatch(match);
    if (trackedProfiles.length === 0) continue;
    const queueType = resolveQueueTypeFromGame(
      match.info.queueId,
      match.info.gameMode,
    );
    if (queueType !== "solo" && queueType !== "flex") continue;
    candidates.push({
      gameCreation: match.info.gameCreation,
      matchId: match.metadata.matchId,
      matchKey,
      participants: trackedProfiles.map((profile) => {
        const participant = match.info.participants.find(
          (candidate) => candidate.puuid === profile.league.leagueAccount.puuid,
        );
        if (participant === undefined) {
          throw new Error(
            `Beta profile ${profile.alias} is absent from ${match.metadata.matchId}`,
          );
        }
        const exceptional = classifyExceptionalPerformance(
          {
            assists: participant.assists,
            deaths: participant.deaths,
            gameEndedInEarlySurrender: participant.gameEndedInEarlySurrender,
            kills: participant.kills,
            pentaKills: participant.pentaKills,
            quadraKills: participant.quadraKills,
            win: participant.win,
          },
          match.info.gameDuration,
        );
        return {
          assists: participant.assists,
          alias: profile.alias,
          championName: participant.championName,
          deaths: participant.deaths,
          exceptionalReason: exceptional.isExceptional
            ? exceptional.reason
            : null,
          kills: participant.kills,
          puuid: participant.puuid,
          riotId: `${participant.riotIdGameName ?? "Unknown"}#${participant.riotIdTagline}`,
          suggestedPerformanceSlice: exceptional.isExceptional
            ? participant.win
              ? "great"
              : "terrible"
            : "average",
          win: participant.win,
        };
      }),
      queueType,
      timelineKey: matchKey.replace(/\/match\.json$/, "/timeline.json"),
    });
  }
  await Bun.write(Bun.stdout, `${JSON.stringify(candidates, null, 2)}\n`);
} finally {
  corpus.close();
  client.destroy();
}
