import { requireCliValue } from "./migration-core.ts";
import { parseDevOrigin } from "./dev-origin.ts";

type DevLoginOptions = {
  readonly discordId: string | undefined;
  readonly username: string | undefined;
  readonly returnTo: string;
  readonly backendOrigin: string;
  readonly webOrigin: string;
};

type ParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: DevLoginOptions };

const DEFAULT_BACKEND_ORIGIN = "http://127.0.0.1:3000";
const DEFAULT_WEB_ORIGIN = "http://localhost:5180";
const DEFAULT_RETURN_TO = "/app/";

function parseReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("--return-to must be a path on the local app");
  }
  return value;
}

export function parseDevLoginArgs(args: readonly string[]): ParseResult {
  let discordId: string | undefined;
  let username: string | undefined;
  let returnTo = DEFAULT_RETURN_TO;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      return { kind: "help" };
    }
    if (argument === "--discord-id") {
      discordId = requireCliValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--username") {
      username = requireCliValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--return-to") {
      returnTo = parseReturnTo(requireCliValue(args, index, argument));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
  }

  return {
    kind: "options",
    options: {
      discordId,
      username,
      returnTo,
      backendOrigin: parseDevOrigin(
        Bun.env["SCOUT_DEV_BACKEND_URL"] ?? DEFAULT_BACKEND_ORIGIN,
        "SCOUT_DEV_BACKEND_URL",
      ),
      webOrigin: parseDevOrigin(
        Bun.env["SCOUT_DEV_WEB_ORIGIN"] ?? DEFAULT_WEB_ORIGIN,
        "SCOUT_DEV_WEB_ORIGIN",
      ),
    },
  };
}

export function buildDevLoginUrl(options: DevLoginOptions): string {
  const url = new URL("/api/dev/login", options.webOrigin);
  if (options.discordId !== undefined) {
    url.searchParams.set("discordId", options.discordId);
  }
  if (options.username !== undefined) {
    url.searchParams.set("username", options.username);
  }
  url.searchParams.set("returnTo", options.returnTo);
  return url.toString();
}

function printHelp(): void {
  console.log(`Usage: bun run dev:login -- [options]

Options:
  --discord-id <snowflake>  Sign in as a chosen Discord user
  --username <name>         Set the local user's display name when provided
  --return-to <path>        Local app path after sign-in (default: /app/)
  --help                    Show this help

The command prints a URL. Open it in a browser or navigate to it with PinchTab.
The backend must already be running on the local dev port. For another copy,
set SCOUT_DEV_BACKEND_URL and SCOUT_DEV_WEB_ORIGIN before running this command.`);
}

async function assertBackendReady(origin: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${origin}/ping`);
  } catch (error) {
    throw new Error(
      `Scout backend is not reachable at ${origin}. Start dev:web first.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Scout backend readiness check failed at ${origin}/ping: HTTP ${response.status.toString()}`,
    );
  }
}

export async function runDevLogin(args: readonly string[]): Promise<void> {
  const parsed = parseDevLoginArgs(args);
  if (parsed.kind === "help") {
    printHelp();
    return;
  }
  await assertBackendReady(parsed.options.backendOrigin);
  console.log(buildDevLoginUrl(parsed.options));
}

if (import.meta.main) {
  await runDevLogin(Bun.argv.slice(2));
}
