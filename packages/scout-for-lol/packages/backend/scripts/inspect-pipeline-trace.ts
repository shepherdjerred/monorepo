/**
 * Read-only inspector for AI review pipeline traces saved to S3.
 *
 * Pulls the persisted Stage-2 trace JSON for a given match and prints a
 * structured summary so you can prove the personality + Glitter Boys lore
 * actually landed in the system prompt the LLM saw.
 *
 * Usage:
 *   bun run scripts/inspect-pipeline-trace.ts --match <matchId>
 *   bun run scripts/inspect-pipeline-trace.ts --match <matchId> --stage 1a-timeline-summary
 *   bun run scripts/inspect-pipeline-trace.ts --match <matchId> --date 2026-05-12
 *   bun run scripts/inspect-pipeline-trace.ts --match <matchId> --days 14
 *
 * No writes. Touches only S3 read APIs.
 */

import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createS3Client } from "#src/storage/s3-client.ts";
import configuration from "#src/configuration.ts";
import { eachDayOfInterval, format, subDays } from "date-fns";

const DEFAULT_STAGE = "2-review-text";
const DEFAULT_LOOKBACK_DAYS = 30;

const StageTraceSchema = z.object({
  stageName: z.string().optional(),
  generatedAt: z.string().optional(),
  request: z.object({
    systemPrompt: z.string().optional(),
    userPrompt: z.string(),
  }),
  response: z.object({
    text: z.string(),
  }),
  model: z.object({
    model: z.string(),
    maxTokens: z.number(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
  }),
  durationMs: z.number(),
  tokensPrompt: z.number().optional(),
  tokensCompletion: z.number().optional(),
});

type ParsedArgs = {
  matchId: string;
  stage: string;
  date: string | undefined;
  days: number;
};

function parseCli(): ParsedArgs {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      match: { type: "string" },
      stage: { type: "string", default: DEFAULT_STAGE },
      date: { type: "string" },
      days: { type: "string", default: String(DEFAULT_LOOKBACK_DAYS) },
    },
    strict: true,
  });

  const matchId = values.match;
  if (matchId === undefined || matchId.length === 0) {
    throw new Error(
      "missing required --match <matchId>; usage: inspect-pipeline-trace --match <id> [--stage 2-review-text] [--date YYYY-MM-DD] [--days N]",
    );
  }

  const stage = values.stage ?? DEFAULT_STAGE;
  const daysParsed = Number(values.days ?? String(DEFAULT_LOOKBACK_DAYS));
  if (!Number.isFinite(daysParsed) || daysParsed < 1) {
    throw new Error("--days must be a positive integer");
  }

  return {
    matchId,
    stage,
    date: values.date,
    days: Math.floor(daysParsed),
  };
}

function datePrefixes(date: string | undefined, days: number): string[] {
  if (date !== undefined && date.length > 0) {
    const [y, m, d] = date.split("-");
    if (y === undefined || m === undefined || d === undefined) {
      throw new Error(`invalid --date "${date}"; expected YYYY-MM-DD`);
    }
    return [`games/${y}/${m}/${d}/`];
  }

  const today = new Date();
  const start = subDays(today, days - 1);
  return eachDayOfInterval({ start, end: today })
    .map((day) => `games/${format(day, "yyyy/MM/dd")}/`)
    .reverse();
}

async function findTraceKey(params: {
  bucket: string;
  matchId: string;
  stage: string;
  prefixes: string[];
}): Promise<string | undefined> {
  const client = createS3Client();
  const suffix = `/${params.matchId}/ai-pipeline/${params.stage}.json`;

  for (const prefix of params.prefixes) {
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: params.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of list.Contents ?? []) {
        const key = obj.Key;
        if (key !== undefined && key.endsWith(suffix)) {
          return key;
        }
      }
      continuationToken = list.NextContinuationToken;
    } while (continuationToken !== undefined);
  }

  return undefined;
}

async function fetchObject(bucket: string, key: string): Promise<string> {
  const client = createS3Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(30_000) },
  );
  if (response.Body === undefined) {
    throw new Error(`empty body for s3://${bucket}/${key}`);
  }
  return response.Body.transformToString();
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function preview(text: string, max: number): string {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, max)}…`;
}

function detectPersonality(systemPrompt: string): string | undefined {
  const match = /You are\s+([A-Za-z][\w\- ]*?),\s*writing/m.exec(systemPrompt);
  return match?.[1]?.trim();
}

function reportSystemPrompt(systemPrompt: string | undefined): void {
  if (systemPrompt === undefined || systemPrompt.length === 0) {
    console.log(
      "⚠️  No systemPrompt captured in trace (stage may not use one).",
    );
    return;
  }

  const hasGlitterHistory =
    systemPrompt.includes("Glitter Boys") &&
    systemPrompt.includes("History of the Glitter Boys");
  const hasRelationshipGraph =
    systemPrompt.includes("digraph") &&
    systemPrompt.includes("Relationship graph");
  const personality = detectPersonality(systemPrompt);

  console.log("System prompt:");
  console.log(
    `  length              : ${systemPrompt.length.toString()} chars`,
  );
  console.log(`  sha256              : ${sha256Hex(systemPrompt)}`);
  console.log(`  detected personality: ${personality ?? "(none detected)"}`);
  console.log(
    `  glitter history     : ${hasGlitterHistory ? "✅ present" : "❌ MISSING"}`,
  );
  console.log(
    `  relationship graph  : ${hasRelationshipGraph ? "✅ present" : "❌ MISSING"}`,
  );

  const personalityIdx = systemPrompt.indexOf("PERSONALITY");
  const personalityWindow =
    personalityIdx >= 0
      ? systemPrompt.slice(personalityIdx, personalityIdx + 400)
      : "";

  const historyMarker = "History of the Glitter Boys";
  const historyIdx = systemPrompt.indexOf(historyMarker);
  const historyWindow =
    historyIdx >= 0 ? systemPrompt.slice(historyIdx, historyIdx + 400) : "";

  const graphMarker = "digraph";
  const graphIdx = systemPrompt.indexOf(graphMarker);
  const graphWindow =
    graphIdx >= 0 ? systemPrompt.slice(graphIdx, graphIdx + 400) : "";

  console.log("");
  console.log(`  persona block preview  : ${preview(personalityWindow, 240)}`);
  console.log(`  history preview        : ${preview(historyWindow, 240)}`);
  console.log(`  graph preview          : ${preview(graphWindow, 240)}`);
}

async function main(): Promise<void> {
  const args = parseCli();
  const bucket = configuration.s3BucketName;
  if (bucket === undefined || bucket.length === 0) {
    throw new Error(
      "S3_BUCKET_NAME is not set; this CLI reads from the same bucket the bot writes to",
    );
  }

  console.log(
    `🔎 looking for trace: match=${args.matchId} stage=${args.stage} bucket=${bucket}`,
  );

  const prefixes = datePrefixes(args.date, args.days);
  const key = await findTraceKey({
    bucket,
    matchId: args.matchId,
    stage: args.stage,
    prefixes,
  });

  if (key === undefined) {
    const scope =
      args.date !== undefined
        ? `date=${args.date}`
        : `last ${args.days.toString()} days`;
    throw new Error(
      `no trace found for matchId=${args.matchId} stage=${args.stage} (${scope})`,
    );
  }

  console.log(`📦 found  : s3://${bucket}/${key}`);
  const body = await fetchObject(bucket, key);
  const parsed: unknown = JSON.parse(body);
  const trace = StageTraceSchema.parse(parsed);

  console.log("");
  console.log(`stage     : ${trace.stageName ?? args.stage}`);
  console.log(`generated : ${trace.generatedAt ?? "(unknown)"}`);
  console.log(
    `model     : ${trace.model.model} (maxTokens=${trace.model.maxTokens.toString()})`,
  );
  console.log(`duration  : ${trace.durationMs.toString()} ms`);
  if (trace.tokensPrompt !== undefined) {
    console.log(`tokens.in : ${trace.tokensPrompt.toString()}`);
  }
  if (trace.tokensCompletion !== undefined) {
    console.log(`tokens.out: ${trace.tokensCompletion.toString()}`);
  }
  console.log("");
  reportSystemPrompt(trace.request.systemPrompt);
  console.log("");
  console.log(
    `user prompt length: ${trace.request.userPrompt.length.toString()} chars`,
  );
  console.log(
    `response length   : ${trace.response.text.length.toString()} chars`,
  );
  console.log(`response preview  : ${preview(trace.response.text, 200)}`);
}

await main();
