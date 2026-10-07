import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import protocol from "#learning-wire";
import { runPaperWorker } from "./owner.ts";
import { root } from "./sandbox.ts";

const args = parseArgs({
  options: {
    dataset: { type: "string" },
    checkpoint: { type: "string" },
    output: { type: "string" },
    device: { type: "string", default: "mps" },
    seed: { type: "string", default: "17000" },
    seconds: { type: "string", default: "3600" },
    updates: { type: "string", default: "100000" },
    episodes: { type: "string", default: "4" },
    opponent: { type: "string", default: "basic" },
    diagnostic: { type: "boolean", default: false },
    curriculum: { type: "boolean", default: false },
  },
  strict: true,
});
const beganMs = Date.now();
const seed = z.coerce
  .number()
  .int()
  .min(0)
  .max(1_000_000_000)
  .parse(args.values.seed);
const seconds = z.coerce
  .number()
  .positive()
  .max(8 * 3600)
  .parse(args.values.seconds);
const updates = z.coerce
  .number()
  .int()
  .min(1)
  .max(100_000)
  .parse(args.values.updates);
const episodes = z.coerce
  .number()
  .int()
  .min(2)
  .max(32)
  .refine((n) => n % 2 === 0)
  .parse(args.values.episodes);
const device = z.enum(["cpu", "mps"]).parse(args.values.device);
const opponent = z
  .enum(protocol.opponents)
  .exclude(["historical"])
  .parse(args.values.opponent);
if (args.values.diagnostic) {
  if (
    updates !== (args.values.curriculum ? 7 : 1) ||
    seconds > 300 ||
    args.values.dataset !== undefined ||
    args.values.checkpoint !== undefined
  )
    throw new Error(
      "diagnostic requires one update (seven with curriculum), at most 300 seconds, and no human inputs",
    );
} else if (args.values.dataset === undefined)
  throw new Error("a genuine human dataset is required");
const output = path.resolve(
  args.values.output ??
    path.join(
      root,
      ".cache/rwf-ppo",
      new Date().toISOString().replaceAll(":", "-"),
    ),
);
await runPaperWorker({
  ...(args.values.dataset === undefined
    ? {}
    : { dataset: path.resolve(args.values.dataset) }),
  ...(args.values.checkpoint === undefined
    ? {}
    : { checkpoint: path.resolve(args.values.checkpoint) }),
  output,
  device,
  seed,
  seconds,
  deadlineMs: beganMs + seconds * 1000,
  updates,
  episodes,
  opponent,
  diagnostic: args.values.diagnostic,
  curriculum: args.values.curriculum,
});
