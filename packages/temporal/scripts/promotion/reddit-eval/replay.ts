import { z } from "zod/v4";
import {
  parseFlagArguments,
  requiredParsedArgument,
} from "#scripts/cli-arguments.ts";
import { loadReplayInputs } from "./inputs.ts";
import { replayRedditOutreach } from "./report.ts";

const USAGE = `bun packages/temporal/scripts/promotion/reddit-eval/replay.ts --snapshot <directory> [--day YYYY-MM-DD]

Reads a local Pacific-day export. Output is JSON and no network calls are made.
  manifest.json                  Snapshot date, if --day is omitted
  threads.jsonl, replies.jsonl   Historical snapshot rows, if available
  decisions.jsonl                Historical model answers, if available
  observations/                  New listing, thread and decision objects
  audits/                        Individual sweep audit objects
  reviews.jsonl                  Optional reviewed labels and cross-post request IDs
  drafts.jsonl                   Optional saved draft inputs and outputs`;

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const options = parseFlagArguments(args, new Set(["--snapshot", "--day"]));
    const directory = requiredParsedArgument(options, "--snapshot");
    const inputs = await loadReplayInputs(directory);
    const requested = options.get("--day");
    const day =
      requested === undefined
        ? inputs.metadata?.date
        : z.iso.date().parse(requested);
    if (day === undefined)
      throw new Error("Provide --day or manifest.json with a date");
    if (inputs.metadata !== undefined && inputs.metadata.date !== day)
      throw new Error("Requested day does not match the snapshot manifest");
    process.stdout.write(
      `${JSON.stringify(replayRedditOutreach(inputs, day), null, 2)}\n`,
    );
  }
}
