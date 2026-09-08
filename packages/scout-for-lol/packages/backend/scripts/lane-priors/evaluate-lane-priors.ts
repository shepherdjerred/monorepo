import {
  evaluateLanePriors,
  LanePriorArtifactSchema,
} from "@scout-for-lol/data/index.ts";
import { parseLanePriorEvalCliConfig } from "./lane-prior-cli.ts";
import {
  deterministicSampleMatches,
  fetchLanePriorMatches,
  listLanePriorMatchKeys,
} from "./lane-prior-s3.ts";

const config = parseLanePriorEvalCliConfig();
const s3Config = {
  bucket: config.bucket,
  startDate: config.startDate,
  endDate: config.endDate,
  queueIds: config.queueIds,
  awsProfile: config.awsProfile,
  endpointUrl: config.endpointUrl,
};
const rawArtifact: unknown = await Bun.file(config.artifactPath).json();
const artifact = LanePriorArtifactSchema.parse(rawArtifact);
const keys = await listLanePriorMatchKeys(s3Config);
const eligibleMatches = await fetchLanePriorMatches(s3Config, keys);
const matches = deterministicSampleMatches({
  matches: eligibleMatches,
  sampleSize: config.sampleSize,
  seed: config.seed,
});

const report = evaluateLanePriors({
  matches,
  artifact,
  sourceStartDate: config.startDate,
  sourceEndDate: config.endDate,
  queueIds: config.queueIds,
  sampleSize: config.sampleSize,
  seed: config.seed,
  threshold: config.threshold,
  generatedAt: new Date().toISOString(),
});

await Bun.write(config.output, `${JSON.stringify(report, null, 2)}\n`);

console.info(
  `Lane-prior eval accuracy: ${report.participantAccuracy.toString()} (${report.correctParticipantCount.toString()}/${report.participantCount.toString()})`,
);
