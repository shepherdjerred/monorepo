import { z } from "zod";
import {
  loadWoodpeckerConfig,
  woodpeckerRequest,
  type WoodpeckerConfig,
} from "./ci.ts";

function argsBeforeBoundary(args: readonly string[]): readonly string[] {
  const boundary = args.indexOf("--");
  return boundary === -1 ? args : args.slice(0, boundary);
}

function hasJsonOutputFlag(args: readonly string[]): boolean {
  const candidates = argsBeforeBoundary(args);
  return (
    !candidates.includes("--help") &&
    !candidates.includes("-h") &&
    (candidates.includes("--json") ||
      candidates.some(
        (arg) =>
          arg === "--output=json" || arg === "-o=json" || arg === "-ojson",
      ) ||
      candidates.some(
        (arg, index) =>
          (arg === "--output" || arg === "-o") &&
          candidates[index + 1] === "json",
      ))
  );
}

export function isWoodpeckerPipelineLsJson(
  command: string,
  args: readonly string[],
): boolean {
  return (
    command === "woodpecker" &&
    args.includes("pipeline") &&
    args.includes("ls") &&
    hasJsonOutputFlag(args)
  );
}

const FLAGS_WITH_VALUE = new Set([
  "--output",
  "-o",
  "--limit",
  "-l",
  "--branch",
  "-b",
  "--event",
  "-e",
  "--status",
  "-s",
  "--before",
  "--after",
  "--server",
  "--token",
  "-t",
  "--config",
  "-c",
  "--log-level",
  "--log-file",
  "--socks-proxy",
]);

type PipelineLsOptions = {
  limit: number;
  branch?: string | undefined;
  event?: string | undefined;
  status?: string | undefined;
  repo?: string | undefined;
};

function parsePipelineOptionFlag(
  arg: string,
  next: string | undefined,
  options: {
    limit: number;
    branch?: string | undefined;
    event?: string | undefined;
    status?: string | undefined;
  },
): void {
  if (next !== undefined && arg === "--limit") {
    options.limit = Number.parseInt(next, 10);
  } else if (arg.startsWith("--limit=")) {
    options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
  } else if (next !== undefined && (arg === "--branch" || arg === "-b")) {
    options.branch = next;
  } else if (arg.startsWith("--branch=")) {
    options.branch = arg.slice("--branch=".length);
  } else if (next !== undefined && (arg === "--event" || arg === "-e")) {
    options.event = next;
  } else if (arg.startsWith("--event=")) {
    options.event = arg.slice("--event=".length);
  } else if (next !== undefined && (arg === "--status" || arg === "-s")) {
    options.status = next;
  } else if (arg.startsWith("--status=")) {
    options.status = arg.slice("--status=".length);
  }
}

function parsePipelineOptions(args: readonly string[]): PipelineLsOptions {
  const options: PipelineLsOptions = { limit: 25 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    parsePipelineOptionFlag(arg, args[i + 1], options);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === "pipeline" || arg === "ls") continue;
    if (arg.startsWith("-")) {
      if (FLAGS_WITH_VALUE.has(arg)) i++;
      continue;
    }
    options.repo = arg;
    break;
  }

  return options;
}

const RepoLookupSchema = z.object({ id: z.number() });

async function fetchPipelineList(
  targetRepo: string,
  query: URLSearchParams,
  config: WoodpeckerConfig,
): Promise<Response> {
  let path = `/api/repos/${targetRepo}/pipelines?${query.toString()}`;
  let res = await woodpeckerRequest(path, config);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") && Number.isNaN(Number(targetRepo))) {
    const lookupRes = await woodpeckerRequest(
      `/api/repos/lookup/${targetRepo}`,
      config,
    );
    const lookup = RepoLookupSchema.parse(await lookupRes.json());
    path = `/api/repos/${String(lookup.id)}/pipelines?${query.toString()}`;
    res = await woodpeckerRequest(path, config);
  }
  return res;
}

export async function handleWoodpeckerPipelineLsJson(
  args: readonly string[],
): Promise<void> {
  const config = await loadWoodpeckerConfig();
  const options = parsePipelineOptions(args);

  const targetRepo = options.repo ?? String(config.repoId);
  const query = new URLSearchParams({
    limit: String(options.limit),
    perPage: String(options.limit),
  });
  if (options.branch !== undefined) query.set("branch", options.branch);
  if (options.event !== undefined) query.set("event", options.event);
  if (options.status !== undefined) query.set("status", options.status);

  const res = await fetchPipelineList(targetRepo, query, config);
  const data = await res.json();
  const sliced = Array.isArray(data) ? data.slice(0, options.limit) : data;
  console.log(JSON.stringify(sliced, null, 2));
}

function positionalArgs(args: readonly string[]): string[] {
  const candidates = argsBeforeBoundary(args);
  const positionals: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const arg = candidates[i];
    if (arg === undefined) continue;
    if (arg.startsWith("-")) {
      if (FLAGS_WITH_VALUE.has(arg)) i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

export function isWoodpeckerPipelineShowJson(
  command: string,
  args: readonly string[],
): boolean {
  if (command !== "woodpecker" || !hasJsonOutputFlag(args)) {
    return false;
  }
  const positionals = positionalArgs(args);
  return positionals[0] === "pipeline" && positionals[1] === "show";
}

async function resolveWoodpeckerRepoId(
  targetRepo: string,
  config: WoodpeckerConfig,
): Promise<string> {
  if (/^\d+$/u.test(targetRepo)) {
    return targetRepo;
  }
  const lookupRes = await woodpeckerRequest(
    `/api/repos/lookup/${targetRepo}`,
    config,
  );
  const lookup = RepoLookupSchema.parse(await lookupRes.json());
  return String(lookup.id);
}

export async function handleWoodpeckerPipelineShowJson(
  args: readonly string[],
): Promise<void> {
  const config = await loadWoodpeckerConfig();
  const operands = positionalArgs(args).slice(2);
  let targetRepo: string;
  let rawPipeline: string;
  if (
    operands.length === 2 &&
    operands[0] !== undefined &&
    operands[1] !== undefined
  ) {
    targetRepo = operands[0];
    rawPipeline = operands[1];
  } else if (
    operands.length === 1 &&
    operands[0] !== undefined &&
    /^\d+$/u.test(operands[0])
  ) {
    targetRepo = String(config.repoId);
    rawPipeline = operands[0];
  } else {
    throw new Error(
      "Usage: toolkit woodpecker pipeline show [repo-id|owner/repo] <pipeline-number> --output json",
    );
  }
  if (!/^[1-9]\d*$/u.test(rawPipeline)) {
    throw new Error(`Invalid Woodpecker pipeline number: ${rawPipeline}`);
  }
  const pipelineNumber = z.coerce.number().int().positive().parse(rawPipeline);
  const repoId = await resolveWoodpeckerRepoId(targetRepo, config);
  const res = await woodpeckerRequest(
    `/api/repos/${repoId}/pipelines/${String(pipelineNumber)}`,
    config,
  );
  const data: unknown = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
