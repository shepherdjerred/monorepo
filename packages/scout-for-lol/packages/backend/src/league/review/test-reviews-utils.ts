import {
  getOrdinalSuffix,
  type ArenaMatch,
  type CompletedMatch,
} from "@scout-for-lol/data/index";
import { eachDayOfInterval, format, startOfDay, endOfDay } from "date-fns";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("review-test-reviews");

const MATCH_TYPES = ["ranked", "unranked", "aram", "arena"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export type TestOptions = {
  matchType: MatchType;
  count: number;
  showPrompt: boolean;
  useS3: boolean;
  s3Days: number;
};

function printHelp(): void {
  logger.info(`
Test AI Review Generation

Usage: bun run src/league/review/test-reviews.ts --s3 [options]

Options:
  -t, --type <type>      Match type: ranked, unranked, aram, arena (default: ranked)
  -c, --count <n>        Number of reviews to generate (default: 10)
  -p, --show-prompt      Show the system prompt used
  --s3                   Fetch random matches from S3 (REQUIRED)
  --s3-days <n>          Number of recent days to search in S3 (default: 7)
  -h, --help             Show this help message

Examples:
  # Generate 10 ranked match reviews from S3
  bun run src/league/review/test-reviews.ts --s3

  # Generate 5 arena match reviews from S3
  bun run src/league/review/test-reviews.ts --s3 --type arena --count 5

  # Generate reviews from last 30 days of S3 matches
  bun run src/league/review/test-reviews.ts --s3 --s3-days 30

  # Generate review and show the prompt
  bun run src/league/review/test-reviews.ts --s3 --show-prompt

Environment:
  OPENAI_API_KEY         Required for AI review generation
  S3_BUCKET_NAME         Required for S3 access
`);
}

export function parseArgs(): TestOptions {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    matchType: "ranked",
    count: 10,
    showPrompt: false,
    useS3: false,
    s3Days: 7,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--type":
      case "-t": {
        const nextArg = args[i + 1];
        if (nextArg) {
          const matchedType = MATCH_TYPES.find((t) => t === nextArg);
          if (matchedType) {
            options.matchType = matchedType;
            i++;
          }
        }
        break;
      }
      case "--count":
      case "-c": {
        const count = Number.parseInt(args[i + 1] ?? "1", 10);
        if (!isNaN(count)) {
          options.count = count;
          i++;
        }
        break;
      }
      case "--show-prompt":
      case "-p": {
        options.showPrompt = true;
        break;
      }
      case "--s3": {
        options.useS3 = true;
        break;
      }
      case "--s3-days": {
        const days = Number.parseInt(args[i + 1] ?? "7", 10);
        if (!isNaN(days) && days > 0) {
          options.s3Days = days;
          i++;
        }
        break;
      }
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
      }
    }
  }

  return options;
}

export function getMatchSummary(match: CompletedMatch | ArenaMatch): string {
  if (match.queueType === "arena") {
    const arenaPlayer = match.players[0];
    if (!arenaPlayer) {
      return "Unknown";
    }
    return `${arenaPlayer.playerConfig.alias} | ${arenaPlayer.champion.championName} | ${String(arenaPlayer.placement)}${getOrdinalSuffix(arenaPlayer.placement)} place | ${String(arenaPlayer.champion.kills)}/${String(arenaPlayer.champion.deaths)}/${String(arenaPlayer.champion.assists)} KDA`;
  } else {
    const player = match.players[0];
    if (!player) {
      return "Unknown";
    }
    return `${player.playerConfig.alias} | ${player.champion.championName} | ${player.lane ?? "unknown"} | ${player.outcome} | ${String(player.champion.kills)}/${String(player.champion.deaths)}/${String(player.champion.assists)} KDA`;
  }
}

export function generateDatePrefixes(startDate: Date, endDate: Date): string[] {
  const days = eachDayOfInterval({
    start: startOfDay(startDate),
    end: endOfDay(endDate),
  });

  return days.map((day) => {
    const year = format(day, "yyyy");
    const month = format(day, "MM");
    const dayStr = format(day, "dd");
    return `matches/${year}/${month}/${dayStr}/`;
  });
}
