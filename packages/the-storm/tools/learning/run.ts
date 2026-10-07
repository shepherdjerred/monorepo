import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { frozenManifest, openPaperDuels, root } from "./sandbox.ts";

const WorkerMessage = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("command"),
      id: z.number().int().positive(),
      command: z
        .string()
        .regex(
          /^(?:state|cancel|begin \d+ (?:red|blue) external (?:stationary|chase|basic|authored)|act [a-f0-9-]+ [a-f0-9-]+ \d+ \d+ [0-8] [01] [01] [01] [01])$/u,
        ),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["ready", "episode", "update", "complete", "censored"]),
      report: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

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
  },
  strict: true,
});
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
  .enum(["stationary", "chase", "basic", "authored"])
  .parse(args.values.opponent);
if (args.values.diagnostic) {
  if (
    updates !== 1 ||
    seconds > 300 ||
    args.values.dataset !== undefined ||
    args.values.checkpoint !== undefined
  )
    throw new Error(
      "diagnostic requires one update, at most 300 seconds, and no human inputs",
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
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
await Bun.write(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      version: 1,
      ...(await frozenManifest()),
      seed,
      seconds,
      episodes,
      updates,
      opponent,
      acceptance: "unaccepted",
      diagnostic: args.values.diagnostic,
    },
    null,
    2,
  ),
);

const child = Bun.spawn(
  [
    "uv",
    "run",
    "--project",
    path.join(root, "tools/learning"),
    "--locked",
    "python",
    path.join(root, "tools/learning/worker.py"),
    "--output",
    path.join(output, "learning"),
    "--device",
    device,
    "--seed",
    seed.toString(),
    "--max-seconds",
    seconds.toString(),
    "--updates",
    updates.toString(),
    "--episodes",
    episodes.toString(),
    "--opponent",
    opponent,
    ...(args.values.dataset === undefined
      ? []
      : ["--dataset", path.resolve(args.values.dataset)]),
    ...(args.values.checkpoint === undefined
      ? []
      : ["--checkpoint", path.resolve(args.values.checkpoint)]),
    ...(args.values.diagnostic ? ["--diagnostic"] : []),
  ],
  {
    stdin: "pipe",
    stdout: "pipe",
    stderr: Bun.file(path.join(output, "worker.log")),
  },
);
let owner: Awaited<ReturnType<typeof openPaperDuels>> | undefined;
let completed = false;
let lastId = 0;
try {
  for await (const line of lines(child.stdout)) {
    const raw: unknown = JSON.parse(line);
    const message = WorkerMessage.parse(raw);
    if (message.kind === "command") {
      if (owner === undefined || message.id !== lastId + 1)
        throw new Error("worker command before readiness or out of order");
      lastId = message.id;
      let response: { id: number; state?: unknown; error?: string };
      try {
        response = {
          id: message.id,
          state: await owner.duels.command(message.command),
        };
      } catch (error) {
        response = {
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await child.stdin.write(JSON.stringify(response) + "\n");
      await child.stdin.flush();
      continue;
    }
    console.warn(JSON.stringify(message));
    if (message.kind === "ready") {
      if (owner !== undefined) throw new Error("duplicate worker readiness");
      owner = await openPaperDuels(output);
    }
    if (message.kind === "complete") completed = true;
  }
  const status = await child.exited;
  if (status !== 0 || !completed)
    throw new Error(
      `Paper PPO worker failed (${status.toString()}): ${output}/worker.log`,
    );
  console.warn(`Evidence: ${output}`);
} finally {
  try {
    await child.stdin.end();
    if (child.exitCode === null) child.kill();
    await child.exited;
  } finally {
    await owner?.stop();
  }
}

async function* lines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      pending += decoder.decode(item.value, { stream: true });
      if (pending.length > 65_536)
        throw new Error("oversized worker protocol line");
      for (;;) {
        const end = pending.indexOf("\n");
        if (end === -1) break;
        yield pending.slice(0, end);
        pending = pending.slice(end + 1);
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) throw new Error("truncated worker protocol line");
  } finally {
    reader.releaseLock();
  }
}
