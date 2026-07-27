import { parseArgs } from "node:util";
import { PACKAGES } from "#lib/screenshot/catalog.ts";
import { screenshotCommand } from "#commands/screenshot/screenshot.ts";

const USAGE = `
toolkit screenshot - boot a package's dev server and capture a screenshot

Usage:
  toolkit screenshot <package> [route] [options]
  toolkit screenshot --list

Options:
  --out <path>              Output PNG path (default: a tmp path, printed)
  --wait-for-selector <s>   CSS selector to poll for before capturing
  --timeout <ms>            Default 60000
  --discord-id <id>         Discord ID to authenticate as, for packages that
                             require it (e.g. scout-app); defaults to a fake
                             test user. Pass the real owner ID to see
                             owner-gated UI.
  --env KEY=VALUE           Repeatable; forces a fresh dev-server spawn
                             (a reused server can't pick up new env vars)
  --viewport <WxH>          e.g. 1280x800
  --theme <light|dark>
  --full-page               Capture the full scrollable page
  --json                    Machine-readable {path, url, durationMs}
  --list                    Print the package registry and exit

Examples:
  toolkit screenshot stocks-sjer-red /
  toolkit screenshot scout-app /app/ --discord-id 160509172704739328
`;

function parseViewport(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`--viewport must look like "1280x800", got "${value}"`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseEnvOverrides(values: string[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const value of values) {
    const eq = value.indexOf("=");
    if (eq === -1) {
      throw new Error(`--env must look like "KEY=VALUE", got "${value}"`);
    }
    overrides[value.slice(0, eq)] = value.slice(eq + 1);
  }
  return overrides;
}

function printRegistry(): void {
  console.log("Known packages:\n");
  for (const entry of PACKAGES) {
    const auth = entry.requiresAuth ? ` (auth: ${entry.requiresAuth})` : "";
    console.log(`  ${entry.alias}${auth}`);
    console.log(`    ${entry.cwd} -> ${entry.defaultRoute}`);
  }
}

export async function handleScreenshotCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    process.exit(0);
  }
  if (subcommand === "--list") {
    printRegistry();
    process.exit(0);
  }
  if (subcommand === undefined) {
    console.error("Usage: toolkit screenshot <package> [route] [options]");
    process.exit(1);
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      out: { type: "string" },
      "wait-for-selector": { type: "string" },
      timeout: { type: "string" },
      "discord-id": { type: "string" },
      env: { type: "string", multiple: true, default: [] },
      viewport: { type: "string" },
      theme: { type: "string" },
      "full-page": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  // args still contains the package alias as positionals[0] (parseArgs was
  // handed the same args index.ts sliced, matching the `deployed` handler's
  // convention) — the route, if given, is positionals[1].
  const route = positionals[1];
  const theme = values.theme;
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    console.error(`--theme must be "light" or "dark", got "${theme}"`);
    process.exit(1);
  }

  // Validate --discord-id up front against the same 17–20 digit snowflake
  // contract the dev-login endpoint enforces (@scout-for-lol/data's
  // DiscordAccountIdSchema). Otherwise a typo'd ID is forwarded, the endpoint
  // 400s, and the driver screenshots the error page while reporting success.
  const discordId = values["discord-id"];
  if (discordId !== undefined && !/^\d{17,20}$/.test(discordId)) {
    console.error(
      `--discord-id must be a 17–20 digit Discord ID, got "${discordId}"`,
    );
    process.exit(1);
  }

  // Reject non-finite / non-positive timeouts up front: `--timeout Infinity`
  // (or a huge value) would make the readiness/selector loops wait forever, and
  // `--timeout nope` → NaN would surface a misleading "within NaNms" error.
  let timeoutMs: number | undefined;
  if (values.timeout !== undefined) {
    const parsed = Number(values.timeout);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error(
        `--timeout must be a positive integer number of milliseconds, got "${values.timeout}"`,
      );
      process.exit(1);
    }
    timeoutMs = parsed;
  }

  try {
    const result = await screenshotCommand({
      alias: subcommand,
      route,
      out: values.out,
      waitForSelector: values["wait-for-selector"],
      timeoutMs,
      authDiscordId: discordId,
      envOverrides: parseEnvOverrides(values.env),
      viewport:
        values.viewport === undefined
          ? undefined
          : parseViewport(values.viewport),
      theme,
      fullPage: values["full-page"],
    });

    if (values.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(
        `Saved ${result.path} (${result.url}, ${String(result.durationMs)}ms)`,
      );
    }
  } catch (error) {
    console.error(
      `toolkit screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
