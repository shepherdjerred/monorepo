import { z } from "zod";

export const DEFAULT_FLAGS_URL = "https://flags.tailnet-1a49.ts.net";

const DeploymentListSchema = z.object({
  deployments: z.array(
    z.object({
      id: z.string(),
      revision: z.number(),
      flagCount: z.number(),
    }),
  ),
});

const FlagSchema = z.object({
  key: z.string(),
  type: z.enum(["boolean", "variant"]),
  default: z.boolean().optional(),
  rollouts: z.array(z.unknown()).optional(),
  value: z.string().optional(),
});

const DocumentSchema = z.object({
  id: z.string(),
  revision: z.number(),
  flags: z.array(FlagSchema),
});

const FlagReadSchema = z.object({
  revision: z.number(),
  flag: FlagSchema,
});

const ApplyResultSchema = z.object({ revision: z.number() });

const ConflictSchema = z.object({
  error: z.string(),
  revision: z.number(),
  flags: z.array(FlagSchema),
});

const IssueSchema = z.object({ path: z.string(), message: z.string() });

const DiffSchema = z.object({
  deployments: z.array(
    z.object({
      id: z.string(),
      missing: z.array(z.unknown()),
      extra: z.array(z.string()),
      drift: z.array(z.object({ key: z.string() })),
      // Flags servers released before value-schema validation omit this.
      invalid: z
        .array(
          z.object({
            key: z.string(),
            value: z.string(),
            issues: z.array(IssueSchema),
          }),
        )
        .default([]),
    }),
  ),
});

const InvalidValuesSchema = z.object({
  error: z.literal("invalid flag values"),
  issues: z.array(IssueSchema.extend({ key: z.string() })),
});

const ApplyFileSchema = z.object({
  deployment: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  flags: z.array(FlagSchema).min(1),
});

export type FlagsFlag = z.infer<typeof FlagSchema>;
export type FlagsDocument = z.infer<typeof DocumentSchema>;

export type FlagsIo = {
  readonly fetch: (input: URL, init?: RequestInit) => Promise<Response>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  readonly baseUrl: string;
  readonly token: string | undefined;
};

/** Rejects a URL that would carry a credential in the request line. */
export function flagsBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("flags URL must not include credentials");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("flags URL must be http or https");
  }
  return url.origin;
}

function deploymentPath(id: string): string {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash !== id.lastIndexOf("/")) {
    throw new Error(`deployment id must be catalog/stage, got ${id}`);
  }
  const catalog = encodeURIComponent(id.slice(0, slash));
  const stage = encodeURIComponent(id.slice(slash + 1));
  return `${catalog}/${stage}`;
}

function presence(flag: FlagsFlag): string {
  if (flag.type === "variant") return flag.value ?? "";
  if ((flag.rollouts?.length ?? 0) > 0) return "targeted";
  return flag.default === true ? "on" : "off";
}

async function readJson(
  io: FlagsIo,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  if (io.token !== undefined)
    headers.set("authorization", `Bearer ${io.token}`);
  const response = await io.fetch(new URL(path, io.baseUrl), {
    ...init,
    headers,
  });
  if (response.status === 304) return { status: 304, body: null };
  const body: unknown = await response.json();
  return { status: response.status, body };
}

export async function runFlags(
  args: readonly string[],
  io: FlagsIo,
  options: { readonly json: boolean; readonly file: string | undefined },
): Promise<number> {
  const [command, ...rest] = args;
  const { json } = options;
  try {
    switch (command) {
      case "deployments":
        return await deployments(io, json, rest);
      case "list":
        return await list(io, json, rest);
      case "get":
        return await get(io, json, rest);
      case "apply":
        if (options.file === undefined || rest.length > 0) {
          usage(io);
          return 1;
        }
        return await applyFlagsFile(io, options.file, json);
      case "diff":
        return await diff(io, json, rest);
      case undefined:
      case "--help":
      case "-h":
        usage(io);
        return command === undefined ? 1 : 0;
      default:
        io.stderr(`Unknown flags command: ${command}`);
        usage(io);
        return 1;
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : "flags command failed");
    return 1;
  }
}

function usage(io: FlagsIo): void {
  io.stderr(`Usage:
  toolkit flags deployments [--json]
  toolkit flags list <deployment> [--json]
  toolkit flags get <deployment> <flag> [--json]
  toolkit flags apply --file <reviewed-json> [--json] [--machine]
  toolkit flags diff [--json]`);
}

async function deployments(
  io: FlagsIo,
  json: boolean,
  rest: readonly string[],
): Promise<number> {
  if (rest.length > 0) {
    usage(io);
    return 1;
  }
  const { status, body } = await readJson(io, "/v1/deployments");
  if (status !== 200) return fail(io, status, body);
  const parsed = DeploymentListSchema.parse(body);
  if (json) {
    io.stdout(JSON.stringify(parsed));
    return 0;
  }
  for (const deployment of parsed.deployments) {
    io.stdout(
      `${deployment.id}\trevision ${String(deployment.revision)}\t${String(deployment.flagCount)} flags`,
    );
  }
  return 0;
}

async function list(
  io: FlagsIo,
  json: boolean,
  rest: readonly string[],
): Promise<number> {
  const id = rest[0];
  if (id === undefined || rest.length !== 1) {
    usage(io);
    return 1;
  }
  const { status, body } = await readJson(
    io,
    `/v1/deployments/${deploymentPath(id)}`,
  );
  if (status !== 200) return fail(io, status, body);
  const document = DocumentSchema.parse(body);
  if (json) {
    io.stdout(JSON.stringify(document));
    return 0;
  }
  for (const flag of document.flags) {
    io.stdout(`${flag.key}\t${flag.type}\t${presence(flag)}`);
  }
  return 0;
}

async function get(
  io: FlagsIo,
  json: boolean,
  rest: readonly string[],
): Promise<number> {
  const id = rest[0];
  const key = rest[1];
  if (id === undefined || key === undefined || rest.length !== 2) {
    usage(io);
    return 1;
  }
  const { status, body } = await readJson(
    io,
    `/v1/deployments/${deploymentPath(id)}/flags/${encodeURIComponent(key)}`,
  );
  if (status !== 200) return fail(io, status, body);
  const parsed = FlagReadSchema.parse(body);
  io.stdout(json ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2));
  return 0;
}

async function diff(
  io: FlagsIo,
  json: boolean,
  rest: readonly string[],
): Promise<number> {
  if (rest.length > 0) {
    usage(io);
    return 1;
  }
  const { status, body } = await readJson(io, "/v1/diff");
  if (status !== 200) return fail(io, status, body);
  const parsed = DiffSchema.parse(body);
  if (json) io.stdout(JSON.stringify(parsed));
  const dirty = parsed.deployments.filter(
    (deployment) =>
      deployment.missing.length > 0 ||
      deployment.extra.length > 0 ||
      deployment.drift.length > 0 ||
      deployment.invalid.length > 0,
  );
  if (!json) {
    for (const deployment of dirty) printDirtyDeployment(io, deployment);
    if (dirty.length === 0) io.stdout("diff empty");
  }
  return dirty.length === 0 ? 0 : 1;
}

function printDirtyDeployment(
  io: FlagsIo,
  deployment: z.infer<typeof DiffSchema>["deployments"][number],
): void {
  const drift = deployment.drift.map((flag) => flag.key).join(",");
  const invalid = deployment.invalid.map((flag) => flag.key).join(",");
  io.stdout(
    `${deployment.id}\tmissing ${String(deployment.missing.length)}\textra ${String(deployment.extra.length)}\tdrift ${drift}\tinvalid ${invalid}`,
  );
  for (const entry of deployment.invalid) {
    for (const issue of entry.issues) {
      io.stdout(`  ${formatIssue({ key: entry.key, ...issue })}`);
    }
  }
}

function formatIssue(issue: {
  readonly key: string;
  readonly path: string;
  readonly message: string;
}): string {
  return issue.path === ""
    ? `${issue.key}: ${issue.message}`
    : `${issue.key} ${issue.path}: ${issue.message}`;
}

function fail(io: FlagsIo, status: number, body: unknown): number {
  io.stderr(`flags ${String(status)}: ${JSON.stringify(body)}`);
  return 1;
}

export async function applyFlagsFile(
  io: FlagsIo,
  file: string,
  json: boolean,
): Promise<number> {
  const parsed = ApplyFileSchema.parse(JSON.parse(await io.readFile(file)));
  const { status, body } = await readJson(
    io,
    `/v1/deployments/${deploymentPath(parsed.deployment)}/apply`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(io.baseUrl).origin,
      },
      body: JSON.stringify({
        expectedRevision: parsed.expectedRevision,
        flags: parsed.flags,
      }),
    },
  );
  if (status === 409) {
    const conflict = ConflictSchema.parse(body);
    const message = `revision conflict at ${String(conflict.revision)}`;
    if (json) io.stdout(JSON.stringify(conflict));
    else io.stderr(message);
    return 2;
  }
  const invalid =
    status === 400 ? InvalidValuesSchema.safeParse(body) : undefined;
  if (invalid?.success === true) {
    printInvalidValues(io, json, invalid.data);
    return 1;
  }
  if (status !== 200) return fail(io, status, body);
  const result = ApplyResultSchema.parse(body);
  io.stdout(
    json ? JSON.stringify(result) : `revised to ${String(result.revision)}`,
  );
  return 0;
}

function printInvalidValues(
  io: FlagsIo,
  json: boolean,
  refused: z.infer<typeof InvalidValuesSchema>,
): void {
  if (json) {
    io.stdout(JSON.stringify(refused));
    return;
  }
  io.stderr("invalid flag values; nothing was written:");
  for (const issue of refused.issues) io.stderr(`  ${formatIssue(issue)}`);
}
