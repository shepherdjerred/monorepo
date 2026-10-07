import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import protocol from "#learning-wire";
import { frozenManifest, openPaperDuels, root } from "./sandbox.ts";
import { WorkerBudget } from "./worker-process.ts";

const actionFields = String.raw`[a-f0-9-]+ [a-f0-9-]+ \d+ \d+ [0-8] [01] [01] [01] [01]`;
const WorkerMessage = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("command"),
      id: z.number().int().positive(),
      command: z
        .string()
        .regex(
          new RegExp(
            String.raw`^(?:state|cancel|begin \d+ (?:red|blue) external (?:${protocol.opponents.join("|")})|act ${actionFields}|acts ${actionFields} ${actionFields})$`,
            "u",
          ),
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

type CommonOptions = {
  output: string;
  device: "cpu" | "mps";
  seed: number;
  seconds: number;
  deadlineMs: number;
  diagnostic: boolean;
};
export type WorkerOptions = CommonOptions &
  (
    | {
        dataset?: string;
        checkpoint?: string;
        updates: number;
        episodes: number;
        opponent: string;
        curriculum: boolean;
        evaluation?: never;
      }
    | {
        checkpoint: string;
        evaluation: { matches: number; firstSeed: number };
        dataset?: never;
        updates?: never;
        episodes?: never;
        opponent?: never;
        curriculum?: never;
      }
  );

/** Own a training/evaluation worker, deadline and Paper server as one lifetime. */
export async function runPaperWorker(options: WorkerOptions) {
  const { output, deadlineMs } = options;
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("Paper training requires macOS or Linux process ownership");
  if (
    deadlineMs <= Date.now() ||
    deadlineMs - Date.now() > options.seconds * 1000
  )
    throw new Error("worker deadline must fit the original seed budget");
  const monotonicDeadline =
    performance.now() +
    Math.min(options.seconds * 1000, deadlineMs - Date.now());
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  await Bun.write(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        version: 2,
        ...(await frozenManifest()),
        ...options,
        acceptance: "unaccepted",
        startedMs: Date.now(),
      },
      null,
      2,
    ),
  );
  if (Date.now() >= deadlineMs)
    throw new Error("budget exhausted while freezing inputs");
  const child = spawnWorker(options);
  const session: Session = { completed: false, lastId: 0 };
  // Imports, uv resolution, device warming and Paper boot are all inside the
  // owner's window. Cleanup may outlive it; optimization cannot.
  const budget = new WorkerBudget(child, monotonicDeadline - performance.now());
  try {
    await serveRequests(child, session, output);
    const status = await child.exited;
    if (
      status !== 0 ||
      budget.expired ||
      budget.interrupted ||
      !session.completed
    )
      throw new Error(
        `Paper learning worker failed (${status.toString()}, budget expired: ${budget.expired.toString()}): ${output}/worker.log`,
      );
    console.warn(`Evidence: ${output}`);
    return { completedMs: Date.now() };
  } finally {
    budget.close();
    try {
      await child.stdin.end();
      budget.stop();
      await child.exited;
    } finally {
      await session.owner?.stop();
    }
  }
}

function spawnWorker(options: WorkerOptions) {
  const { output, deadlineMs } = options;
  const operation =
    options.evaluation === undefined
      ? [
          "--max-seconds",
          options.seconds.toString(),
          "--updates",
          options.updates.toString(),
          "--episodes",
          options.episodes.toString(),
          "--opponent",
          options.opponent,
          ...(options.dataset === undefined
            ? []
            : ["--dataset", options.dataset]),
          ...(options.curriculum ? ["--curriculum"] : []),
        ]
      : [
          "--matches",
          options.evaluation.matches.toString(),
          "--first-seed",
          options.evaluation.firstSeed.toString(),
        ];
  return Bun.spawn(
    [
      "uv",
      "run",
      "--project",
      path.join(root, "tools/learning"),
      "--locked",
      "python",
      path.join(
        root,
        "tools/learning",
        options.evaluation === undefined ? "worker.py" : "evaluate.py",
      ),
      "--output",
      path.join(output, "learning"),
      "--device",
      options.device,
      "--seed",
      options.seed.toString(),
      "--deadline-ms",
      deadlineMs.toString(),
      ...operation,
      ...(options.checkpoint === undefined
        ? []
        : ["--checkpoint", options.checkpoint]),
      ...(options.diagnostic ? ["--diagnostic"] : []),
    ],
    {
      detached: true,
      stdin: "pipe",
      stdout: "pipe",
      stderr: Bun.file(path.join(output, "worker.log")),
    },
  );
}

type Worker = ReturnType<typeof spawnWorker>;
type Session = {
  owner?: Awaited<ReturnType<typeof openPaperDuels>>;
  completed: boolean;
  lastId: number;
};

async function answer(
  child: Worker,
  session: Session,
  id: number,
  command: string,
) {
  if (session.owner === undefined || id !== session.lastId + 1)
    throw new Error("worker command before readiness or out of order");
  session.lastId = id;
  let response: { id: number; state?: unknown; error?: string };
  try {
    response = { id, state: await session.owner.duels.command(command) };
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await child.stdin.write(JSON.stringify(response) + "\n");
  await child.stdin.flush();
}

async function serveRequests(child: Worker, session: Session, output: string) {
  for await (const line of lines(child.stdout)) {
    const raw: unknown = JSON.parse(line);
    const message = WorkerMessage.parse(raw);
    if (session.owner === undefined && message.kind !== "ready")
      throw new Error("worker report before readiness");
    if (session.completed)
      throw new Error("worker sent messages after completion");
    if (message.kind === "command") {
      await answer(child, session, message.id, message.command);
      continue;
    }
    console.warn(JSON.stringify(message));
    if (message.kind === "ready") {
      if (session.owner !== undefined)
        throw new Error("duplicate worker readiness");
      session.owner = await openPaperDuels(output);
    }
    if (message.kind === "complete") session.completed = true;
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
