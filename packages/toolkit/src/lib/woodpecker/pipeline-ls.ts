import { z } from "zod";
import {
  loadWoodpeckerConfig,
  woodpeckerRequest,
  type WoodpeckerConfig,
} from "./ci.ts";

export function isWoodpeckerPipelineLsJson(
  command: string,
  args: readonly string[],
): boolean {
  return (
    command === "woodpecker" &&
    args.includes("pipeline") &&
    args.includes("ls") &&
    (args.includes("--json") ||
      args.some(
        (a) => a === "--output=json" || a.startsWith("--output=json"),
      ) ||
      args.some(
        (a, i) => (a === "--output" || a === "-o") && args[i + 1] === "json",
      ))
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
