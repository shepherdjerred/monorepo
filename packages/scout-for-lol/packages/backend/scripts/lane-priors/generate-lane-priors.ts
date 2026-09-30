import { buildLanePriorArtifact } from "@scout-for-lol/data/index.ts";
import { parseLanePriorCliConfig } from "./lane-prior-cli.ts";
import {
  fetchLanePriorMatches,
  listLanePriorMatchKeys,
} from "./lane-prior-s3.ts";

const config = parseLanePriorCliConfig();
const s3Config = {
  bucket: config.bucket,
  startDate: config.startDate,
  endDate: config.endDate,
  queueIds: config.queueIds,
  awsProfile: config.awsProfile,
  endpointUrl: config.endpointUrl,
};
const keys = await listLanePriorMatchKeys(s3Config);
const matches = await fetchLanePriorMatches(s3Config, keys);
if (matches.length === 0) {
  throw new Error("No eligible S3 matches found for lane-prior generation");
}

const artifact = buildLanePriorArtifact({
  matches,
  queueIds: config.queueIds,
  sourceStartDate: config.startDate,
  sourceEndDate: config.endDate,
  generatedAt: new Date().toISOString(),
});

await Bun.write(config.output, `${JSON.stringify(artifact, null, 2)}\n`);

console.info(
  `Generated lane priors from ${artifact.source.matchCount.toString()} matches and ${artifact.source.participantCount.toString()} participants`,
);
