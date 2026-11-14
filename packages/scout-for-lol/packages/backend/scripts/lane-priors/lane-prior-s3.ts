import { z } from "zod";
import { type RawMatch } from "@scout-for-lol/data/index.ts";
import {
  createRawMatchS3Source,
  RawMatchS3ConfigSchema,
  type RawMatchS3Config,
} from "../s3/raw-match-s3.ts";

export const LanePriorS3ConfigSchema = RawMatchS3ConfigSchema.extend({
  queueIds: z.array(z.number().int().positive()).min(1),
});

export type LanePriorS3Config = z.infer<typeof LanePriorS3ConfigSchema>;

function sourceConfig(config: LanePriorS3Config): RawMatchS3Config {
  return RawMatchS3ConfigSchema.parse({
    bucket: config.bucket,
    startDate: config.startDate,
    endDate: config.endDate,
    ...(config.awsProfile === undefined
      ? {}
      : { awsProfile: config.awsProfile }),
    ...(config.endpointUrl === undefined
      ? {}
      : { endpointUrl: config.endpointUrl }),
  });
}

function queueFiltered(match: RawMatch, queueIds: readonly number[]): boolean {
  return queueIds.includes(match.info.queueId);
}

export async function listLanePriorMatchKeys(
  rawConfig: LanePriorS3Config,
): Promise<string[]> {
  const config = LanePriorS3ConfigSchema.parse(rawConfig);
  const source = createRawMatchS3Source(sourceConfig(config));
  const keys = await source.listMatchKeys();
  return keys.toSorted();
}

export async function fetchLanePriorMatches(
  rawConfig: LanePriorS3Config,
  keys: readonly string[],
): Promise<RawMatch[]> {
  const config = LanePriorS3ConfigSchema.parse(rawConfig);
  const source = createRawMatchS3Source(sourceConfig(config));
  const matches: RawMatch[] = [];

  for (const key of keys) {
    const record = await source.fetchMatch(key);
    // Lane priors are fitted on complete Match-V5 documents only.
    if (
      record.coverage === "complete" &&
      queueFiltered(record.match, config.queueIds)
    ) {
      matches.push(record.match);
    }
  }

  return matches;
}

export function deterministicSampleMatches(input: {
  matches: readonly RawMatch[];
  sampleSize: number;
  seed: string;
}): RawMatch[] {
  if (input.sampleSize <= 0) {
    throw new Error("sampleSize must be positive");
  }
  if (input.matches.length < input.sampleSize) {
    throw new Error(
      `Requested ${input.sampleSize.toString()} holdout matches but only ${input.matches.length.toString()} eligible matches were available`,
    );
  }
  return input.matches
    .map((match) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(`${input.seed}:${match.metadata.matchId}`);
      return { match, hash: hasher.digest("hex") };
    })
    .toSorted((left, right) => left.hash.localeCompare(right.hash))
    .slice(0, input.sampleSize)
    .map((entry) => entry.match);
}
