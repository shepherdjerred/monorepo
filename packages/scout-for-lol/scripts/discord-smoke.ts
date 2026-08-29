import path from "node:path";
import {
  createTestDatabase,
  dropTestDatabase,
} from "@scout-for-lol/backend/testing/test-database.ts";
import {
  ensureTestTemplate,
  sweepStaleTestDatabases,
} from "@scout-for-lol/backend/testing/test-template.ts";
import { verifyPinchTabProfile } from "./discord-smoke-browser.ts";
import {
  DiscordSmokeManifestSchema,
  loadDiscordSmokeFixture,
  loadDiscordSmokeManifest,
  preflightDiscordSmoke,
  raceRuntimeOperation,
  waitForRuntimeReadiness,
  waitForDiscordCommand,
  writeDiscordSmokeManifest,
} from "./discord-smoke-core.ts";
import { requireCliValue } from "./migration-core.ts";

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../..");
const SCOUT_ROOT = path.resolve(import.meta.dir, "..");
const FIXTURE_PATH = path.join(import.meta.dir, "discord-smoke.fixture.json");

type SmokeArguments =
  | { readonly kind: "fresh"; readonly scenario: "gateway" }
  | { readonly kind: "resume"; readonly runId: string };

export function parseDiscordSmokeArguments(
  args: readonly string[],
): SmokeArguments {
  if (args[0] === "--resume") {
    return { kind: "resume", runId: requireCliValue(args, 0, "--resume") };
  }
  if (args[0] === "--scenario") {
    const scenario = requireCliValue(args, 0, "--scenario");
    if (scenario !== "gateway") {
      throw new Error(`Unknown Discord smoke scenario: ${scenario}`);
    }
    return { kind: "fresh", scenario };
  }
  throw new Error(
    "Usage: test:discord:smoke -- --scenario gateway | --resume <run-id>",
  );
}

function runDirectory(runId: string): string {
  return path.join(WORKSPACE_ROOT, ".context", "discord-smoke", runId);
}

async function stopChild(child: Bun.Subprocess | null): Promise<void> {
  if (child?.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await child.exited;
}

async function runGatewaySmoke(): Promise<void> {
  const fixture = await loadDiscordSmokeFixture(FIXTURE_PATH);
  await preflightDiscordSmoke(fixture, Bun.env, {
    fetch,
    verifyPinchTabProfile,
  });

  const runId = `${new Date()
    .toISOString()
    .replaceAll(/\D/gu, "")
    .slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
  const manifestPath = path.join(runDirectory(runId), "manifest.json");
  const runtimeReadyPath = path.join(runDirectory(runId), "runtime-ready.json");
  let manifest = DiscordSmokeManifestSchema.parse({
    runId,
    scenario: "gateway",
    createdAt: new Date().toISOString(),
    databaseName: null,
    databaseUrl: null,
    invocationStartedAt: null,
    privateReplyId: null,
    publicMessageId: null,
    verifiedAt: null,
    screenshotPath: null,
  });
  await writeDiscordSmokeManifest(manifestPath, manifest);

  await ensureTestTemplate();
  sweepStaleTestDatabases();
  const database = createTestDatabase(`discord_smoke_${runId}`);
  manifest = {
    ...manifest,
    databaseName: database.dbPath,
    databaseUrl: database.dbUrl,
  };
  await writeDiscordSmokeManifest(manifestPath, manifest);

  let runtime: Bun.Subprocess | null = null;
  let successful = false;
  try {
    runtime = Bun.spawn(
      [
        "bun",
        "scripts/dev-discord.ts",
        "--scenario",
        "gateway",
        "--database-url",
        database.dbUrl,
      ],
      {
        cwd: SCOUT_ROOT,
        env: {
          ...Bun.env,
          SCOUT_DISCORD_SMOKE_GUILD_ID: fixture.guildId,
          SCOUT_DISCORD_SMOKE_READY_PATH: runtimeReadyPath,
        },
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const botToken = Bun.env["DISCORD_BOT_TOKEN"];
    if (botToken === undefined) {
      throw new Error("Discord smoke lost DISCORD_BOT_TOKEN after preflight");
    }
    await waitForRuntimeReadiness(runtime, runtimeReadyPath);
    await raceRuntimeOperation(
      runtime,
      waitForDiscordCommand({
        fixture,
        botToken,
        commandName: "help",
        guildScoped: false,
      }),
      "before exposing /help",
    );
    manifest = { ...manifest, verifiedAt: new Date().toISOString() };
    await writeDiscordSmokeManifest(manifestPath, manifest);
    successful = true;
  } finally {
    await stopChild(runtime);
    if (successful) {
      await dropTestDatabase(database.prisma, database.dbPath);
    } else {
      await database.prisma.$disconnect();
    }
  }
  console.log(`Discord gateway smoke passed: ${runId}`);
}

if (import.meta.main) {
  const args = parseDiscordSmokeArguments(Bun.argv.slice(2));
  if (args.kind === "resume") {
    const manifest = await loadDiscordSmokeManifest(
      path.join(runDirectory(args.runId), "manifest.json"),
    );
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    await runGatewaySmoke();
  }
}
