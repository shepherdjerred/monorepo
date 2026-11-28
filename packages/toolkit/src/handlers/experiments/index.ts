import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  AmendExperimentSchema,
  CreateExperimentSchema,
  EditExperimentSchema,
  EvidenceExperimentSchema,
  ExperimentIdSchema,
  ExperimentListQuerySchema,
  ExperimentListSchema,
  ExperimentSchema,
  LinkExperimentSchema,
  ReviewExperimentSchema,
  StartExperimentSchema,
} from "@shepherdjerred/experiments/contract";
import { parseArgs } from "node:util";
import { z } from "zod";
import { requestExperiments } from "#lib/experiments.ts";

const HELP = `toolkit experiments - Plan, run, and review experiments in Hub

  list [--view all|due|running|drafts|decided] [--q <query>]
  show <id>
  create --file <path|->
  edit <id> --expected-revision <n> --file <path|->
  start <id> --expected-revision <n>
  amend <id> --expected-revision <n> --file <path|->
  link <id> --expected-revision <n> --file <path|->
  evidence <id> --expected-revision <n> --file <path|->
  review <id> --expected-revision <n> --file <path|->

--file reads a JSON object. Use - to read stdin. All writes accept --request-id
<uuid> for safe retries. Read the latest revision with show before a new edit.
All commands accept --json and --url <origin>. Set EXPERIMENTS_MACHINE_TOKEN
explicitly for a custom origin. The default origin uses the credential broker.`;

const COMMON = {
  json: { type: "boolean", default: false },
  url: { type: "string" },
} as const;

const MUTATION_OPTIONS = {
  ...COMMON,
  "expected-revision": { type: "string" },
  "request-id": { type: "string" },
  file: { type: "string" },
} as const;

const MUTATIONS = new Map<string, z.ZodType>([
  ["create", CreateExperimentSchema],
  ["edit", EditExperimentSchema],
  ["start", StartExperimentSchema],
  ["amend", AmendExperimentSchema],
  ["link", LinkExperimentSchema],
  ["evidence", EvidenceExperimentSchema],
  ["review", ReviewExperimentSchema],
]);

function withHubUrl<T extends { id: string }>(
  experiment: T,
): T & { url: string } {
  return {
    ...experiment,
    url: new URL(
      `/experiments/${encodeURIComponent(experiment.id)}`,
      APP_HOSTS.hub,
    ).href,
  };
}

function printResult(result: unknown, json: boolean): void {
  console.log(JSON.stringify(result, null, json ? undefined : 2));
}

function experimentId(positionals: readonly string[]): string {
  if (positionals.length !== 1)
    throw new Error("Supply exactly one experiment ID.");
  return ExperimentIdSchema.parse(positionals[0]);
}

function expectedRevision(raw: string | undefined): number {
  const value = raw === undefined || !/^\d+$/u.test(raw) ? NaN : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      "Supply --expected-revision with a positive integer from `toolkit experiments show`.",
    );
  }
  return value;
}

async function readPayload(
  file: string | undefined,
): Promise<Record<string, unknown>> {
  if (file === undefined || file === "") {
    throw new Error("Supply --file <path|-> with a JSON object.");
  }
  const text =
    file === "-" ? await Bun.stdin.text() : await Bun.file(file).text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("The input must be valid JSON.");
  }
  const input = z.record(z.string(), z.unknown()).safeParse(payload);
  if (!input.success) throw new Error("The input must be a JSON object.");
  if (
    Object.hasOwn(input.data, "requestId") ||
    Object.hasOwn(input.data, "expectedRevision")
  ) {
    throw new Error(
      "Use --request-id and --expected-revision to supply write metadata.",
    );
  }
  return input.data;
}

async function listExperiments(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { ...COMMON, view: { type: "string" }, q: { type: "string" } },
  });
  const filter = ExperimentListQuerySchema.parse({
    view: values.view,
    q: values.q,
  });
  const query = new URLSearchParams();
  if (filter.view !== undefined) query.set("view", filter.view);
  if (filter.q !== undefined) query.set("q", filter.q);
  const result = await requestExperiments(
    values.url,
    { method: "GET", query },
    ExperimentListSchema,
  );
  printResult(
    { ...result, items: result.items.map((item) => withHubUrl(item)) },
    values.json,
  );
}

async function showExperiment(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: COMMON,
    allowPositionals: true,
  });
  const id = experimentId(positionals);
  const record = await requestExperiments(
    values.url,
    { method: "GET", path: `/${id}` },
    ExperimentSchema,
  );
  printResult(withHubUrl(record), values.json);
}

async function mutateExperiment(
  subcommand: string,
  args: string[],
): Promise<void> {
  const schema = MUTATIONS.get(subcommand);
  if (schema === undefined)
    throw new Error(`Unknown experiments subcommand: ${subcommand}`);
  const { values, positionals } = parseArgs({
    args,
    options: MUTATION_OPTIONS,
    allowPositionals: true,
  });
  const create = subcommand === "create";
  if (
    create &&
    (positionals.length > 0 || values["expected-revision"] !== undefined)
  ) {
    throw new Error(
      "Create takes --file and generates a new experiment ID and revision.",
    );
  }
  if (subcommand === "start" && values.file !== undefined) {
    throw new Error("Start takes the experiment ID and --expected-revision.");
  }
  const id = create ? "" : experimentId(positionals);
  const requestId = z.uuid().parse(values["request-id"] ?? crypto.randomUUID());
  const metadata = create
    ? { requestId }
    : {
        requestId,
        expectedRevision: expectedRevision(values["expected-revision"]),
      };
  const input = subcommand === "start" ? {} : await readPayload(values.file);
  const body = schema.parse({ ...input, ...metadata });
  const path = create
    ? ""
    : subcommand === "edit"
      ? `/${id}`
      : `/${id}/${subcommand}`;
  const method = subcommand === "edit" ? "PATCH" : "POST";
  const record = await requestExperiments(
    values.url,
    { method, path, body, requestId },
    ExperimentSchema,
  );
  printResult(withHubUrl(record), values.json);
}

export async function handleExperimentsCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    ["--help", "-h"].includes(subcommand) ||
    args.some((argument) => argument === "--help" || argument === "-h")
  ) {
    console.log(HELP);
    return;
  }
  if (subcommand === "list") await listExperiments(args);
  else if (subcommand === "show") await showExperiment(args);
  else await mutateExperiment(subcommand, args);
}
