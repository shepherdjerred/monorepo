/**
 * The inputs for running a Paper suite against an already-running external
 * server (`STORM_E2E_HOST` set) instead of a local Docker container. Every
 * input is declared; a missing or malformed one fails the run before any test
 * starts, with every problem named at once.
 *
 * The server must have been booted fresh for this one suite run, staged for
 * the suite's profile (`gameplay-fixtures.ts`), and pointed at the fake brain
 * named here. The suites mutate its world and data, so a server is never
 * reused for a second run.
 */
import { z } from "zod";
import type { E2eProfile } from "#e2e/gameplay-fixtures.ts";
import {
  ServerFilesSchema,
  type ServerFiles,
} from "#e2e/harness/external/files.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";

/** What an external server adds to the connection in `ServerInfo` (server.ts). */
export const ExternalServerShape = {
  kind: z.literal("external"),
  files: ServerFilesSchema,
  /** Paper's UDP Query port; declared only where a suite reads Query. */
  queryPort: z.number().int().positive().nullable(),
};

const Port = z.coerce.number().int().min(1).max(65_535);
const Text = z.string().min(1);

/** Declared for every external run. */
const REQUIRED = {
  /** DNS name or IP of the server, reachable for game and RCON traffic. */
  STORM_E2E_HOST: Text,
  STORM_E2E_GAME_PORT: Port,
  STORM_E2E_RCON_PORT: Port,
  STORM_E2E_RCON_PASSWORD: z.string().min(16),
  /** The fake brain (`fake-brain.ts`) the server was booted against. */
  STORM_E2E_BRAIN_HOST: Text,
  STORM_E2E_BRAIN_PORT: Port,
} as const;

/** Server file transports; exactly one is declared. */
const SHARED = {
  STORM_E2E_LOG_FILE: Text,
  STORM_E2E_STORM_DATA_DIR: Text,
} as const;
const HTTP = {
  STORM_E2E_FILES_URL: z.url({ protocol: /^https?$/u }),
  STORM_E2E_FILES_TOKEN: z.string().min(16),
} as const;

/** Paper's UDP Query port; the all-module suite reads public Query. */
const QUERY = { STORM_E2E_QUERY_PORT: Port } as const;

export type ExternalServer = {
  server: ServerInfo & { kind: "external" };
  brain: { host: string; port: number };
};

type Environment = Readonly<Record<string, string | undefined>>;

/** The profiles that read public Query from the server. */
function needsQuery(profile: E2eProfile): boolean {
  return profile !== "e2e";
}

function parseGroup<Shape extends z.ZodRawShape>(
  shape: Shape,
  env: Environment,
  problems: string[],
): z.infer<z.ZodObject<Shape>> | undefined {
  for (const name of Object.keys(shape))
    if (env[name] === undefined || env[name] === "")
      problems.push(`${name} is required`);
  const parsed = z.object(shape).safeParse(env);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const name = String(issue.path[0]);
    if (env[name] !== undefined && env[name] !== "")
      problems.push(`${name} is invalid: ${issue.message}`);
  }
  return undefined;
}

function declared(shape: z.ZodRawShape, env: Environment): boolean {
  return Object.keys(shape).some((name) => env[name] !== undefined);
}

function parseFiles(
  env: Environment,
  problems: string[],
): ServerFiles | undefined {
  const shared = declared(SHARED, env);
  const http = declared(HTTP, env);
  if (shared && http) {
    problems.push(
      `Declare one server file transport: ${Object.keys(SHARED).join(" + ")} (shared folders) or ${Object.keys(HTTP).join(" + ")} (external/files-service.ts), not both`,
    );
    return undefined;
  }
  if (!shared && !http) {
    problems.push(
      `A server file transport is required: ${Object.keys(SHARED).join(" + ")} (shared folders) or ${Object.keys(HTTP).join(" + ")} (external/files-service.ts)`,
    );
    return undefined;
  }
  if (shared) {
    const values = parseGroup(SHARED, env, problems);
    return values === undefined
      ? undefined
      : ServerFilesSchema.parse({
          kind: "shared",
          logFile: values.STORM_E2E_LOG_FILE,
          stormDataDir: values.STORM_E2E_STORM_DATA_DIR,
        });
  }
  const values = parseGroup(HTTP, env, problems);
  return values === undefined
    ? undefined
    : ServerFilesSchema.parse({
        kind: "http",
        url: values.STORM_E2E_FILES_URL,
        token: values.STORM_E2E_FILES_TOKEN,
      });
}

/**
 * The declared external server for `profile`. Throws one error naming every
 * missing or malformed input.
 */
export function parseExternalServer(
  env: Environment,
  profile: E2eProfile,
): ExternalServer {
  const problems: string[] = [];
  if (profile === "capacity")
    problems.push(
      "The capacity profile requires its owned preboot feature fixture and cannot use an external server",
    );
  const required = parseGroup(REQUIRED, env, problems);
  const files = parseFiles(env, problems);
  const query =
    needsQuery(profile) || declared(QUERY, env)
      ? parseGroup(QUERY, env, problems)
      : undefined;
  if (
    required === undefined ||
    files === undefined ||
    problems.length > 0 ||
    (query === undefined && needsQuery(profile))
  )
    throw new Error(
      `The external Paper server for the ${profile} profile is not fully declared:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  return {
    server: {
      kind: "external",
      host: required.STORM_E2E_HOST,
      gamePort: required.STORM_E2E_GAME_PORT,
      rconPort: required.STORM_E2E_RCON_PORT,
      rconPassword: required.STORM_E2E_RCON_PASSWORD,
      queryPort: query?.STORM_E2E_QUERY_PORT ?? null,
      files,
    },
    brain: {
      host: required.STORM_E2E_BRAIN_HOST,
      port: required.STORM_E2E_BRAIN_PORT,
    },
  };
}
