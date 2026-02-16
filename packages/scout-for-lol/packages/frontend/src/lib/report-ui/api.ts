import { z } from "zod";

const RIOT_API_BASE = "https://americas.api.riotgames.com";

// Riot API response schema
const RiotMatchResponseSchema = z.object({
  metadata: z.object({
    data_version: z.string(),
    match_id: z.string(),
    participants: z.array(z.string()),
  }),
  info: z.object({
    game_duration: z.number(),
    game_mode: z.string(),
    match_creation: z.number(),
    match_id: z.string(),
    platform_id: z.string(),
    queue_id: z.number(),
    participants: z.array(
      z.object({
        assists: z.number(),
        championName: z.string(),
        deaths: z.number(),
        gold: z.number(),
        kills: z.number(),
        item0: z.number(),
        item1: z.number(),
        item2: z.number(),
        item3: z.number(),
        item4: z.number(),
        item5: z.number(),
        item6: z.number(),
        lane: z.string(),
        level: z.number(),
        puuid: z.string(),
        role: z.string(),
        summoner1Id: z.number(),
        summoner2Id: z.number(),
        teamId: z.number(),
        totalDamageDealtToChampions: z.number(),
        totalMinionsKilled: z.number(),
        visionScore: z.number(),
        win: z.boolean(),
      }),
    ),
  }),
});

// Riot API types (for reference - not fully enforced)
type RiotMatchResponse = {
  metadata: {
    data_version: string;
    match_id: string;
    participants: string[];
  };
  info: {
    game_duration: number;
    game_mode: string;
    match_creation: number;
    match_id: string;
    platform_id: string;
    queue_id: number;
    participants: {
      assists: number;
      championName: string;
      deaths: number;
      gold: number;
      kills: number;
      item0: number;
      item1: number;
      item2: number;
      item3: number;
      item4: number;
      item5: number;
      item6: number;
      lane: string;
      level: number;
      puuid: string;
      role: string;
      summoner1Id: number;
      summoner2Id: number;
      teamId: number;
      totalDamageDealtToChampions: number;
      totalMinionsKilled: number;
      visionScore: number;
      win: boolean;
    }[];
  };
};

export async function fetchMatchFromRiot(
  matchId: string,
  _region: string,
  apiToken: string,
): Promise<{ match: null; error?: string }> {
  try {
    const response = await fetch(`${RIOT_API_BASE}/lol/match/v5/matches/${matchId}`, {
      headers: {
        "X-Riot-Token": apiToken,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { match: null, error: "Match not found" };
      }
      if (response.status === 429) {
        return { match: null, error: "Rate limited by Riot API" };
      }
      const statusCode = String(response.status);
      return {
        match: null,
        error: `Riot API error: ${statusCode}`,
      };
    }

    const data = await response.json();
    const dataValidated = RiotMatchResponseSchema.safeParse(data);
    if (!dataValidated.success) {
      return { match: null, error: "Invalid API response" };
    }
    const match = parseRiotMatch(dataValidated.data);
    return { match };
  } catch (err) {
    const ErrorOrStringSchema = z.union([z.instanceof(Error), z.string()]);
    const errorZod = ErrorOrStringSchema.safeParse(err);
    let errorMessage = "Unknown error";
    if (errorZod.success) {
      const errorData = errorZod.data;
      if (errorData instanceof Error) {
        errorMessage = errorData.message;
      } else {
        errorMessage = errorData;
      }
    }
    return { match: null, error: errorMessage };
  }
}

function parseRiotMatch(riotMatch: RiotMatchResponse): null {
  // This is a simplified parser - you'll need to map Riot's data structure
  // to your CompletedMatch format properly
  // For now, returning null to indicate this needs implementation
  console.log("Match data:", riotMatch);
  return null;
}
