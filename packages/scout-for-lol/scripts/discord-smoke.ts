import path from "node:path";
import {
  connectTestDatabase,
  createTestDatabase,
  dropTestDatabase,
} from "@scout-for-lol/backend/testing/test-database.ts";
import {
  ensureTestTemplate,
  sweepStaleTestDatabases,
} from "@scout-for-lol/backend/testing/test-template.ts";
import { verifyPinchTabProfile } from "./discord-smoke-browser.ts";
import {
  assertTransferResponse,
  captureReceipt,
  findReceiptMessageId,
  invokeTransfer,
  seedTransferAccounts,
  verifyTransferDatabase,
} from "./discord-smoke-bb-transfer.ts";
import {
  type DiscordSmokeFixture,
  type DiscordSmokeManifest,
  DiscordSmokeManifestSchema,
  assertInvocationAllowed,
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
const TOOLKIT_ENTRYPOINT = path.join(
  WORKSPACE_ROOT,
  "packages",
  "toolkit",
  "src",
  "index.ts",
);
const FIXTURE_PATH = path.join(import.meta.dir, "discord-smoke.fixture.json");

type SmokeArguments =
  | { readonly kind: "fresh"; readonly scenario: "gateway" | "bb-transfer" }
  | { readonly kind: "resume"; readonly runId: string };

type SmokeDatabase = ReturnType<typeof connectTestDatabase>;

type FreshSmokeRun = {
  readonly database: Awaited<ReturnType<typeof createIsolatedDatabase>>;
  readonly manifest: DiscordSmokeManifest;
  readonly manifestPath: string;
  readonly runId: string;
};

export function parseDiscordSmokeArguments(
  args: readonly string[],
): SmokeArguments {
  if (args[0] === "--resume") {
    return { kind: "resume", runId: requireCliValue(args, 0, "--resume") };
  }
  if (args[0] === "--scenario") {
    const scenario = requireCliValue(args, 0, "--scenario");
    if (scenario !== "gateway" && scenario !== "bb-transfer") {
      throw new Error(`Unknown Discord smoke scenario: ${scenario}`);
    }
    return { kind: "fresh", scenario };
  }
  throw new Error(
    "Usage: test:discord:smoke -- --scenario gateway|bb-transfer | --resume <run-id>",
  );
}

function runDirectory(runId: string): string {
  return path.join(WORKSPACE_ROOT, ".context", "discord-smoke", runId);
}

function createRunId(): string {
  return `${new Date()
    .toISOString()
    .replaceAll(/\D/gu, "")
    .slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
}

function createManifest(
  runId: string,
  scenario: "gateway" | "bb-transfer",
): DiscordSmokeManifest {
  return DiscordSmokeManifestSchema.parse({
    runId,
    scenario,
    createdAt: new Date().toISOString(),
    databaseName: null,
    databaseUrl: null,
    seededAccounts: null,
    invocationStartedAt: null,
    privateReplyId: null,
    publicMessageId: null,
    verifiedAt: null,
    screenshotPath: null,
  });
}

function requireEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Discord smoke lost ${name} after preflight`);
  }
  return value;
}

async function stopChild(child: Bun.Subprocess | null): Promise<void> {
  if (child === null) return;
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(5000).then(() => false),
  ]);
  if (!stopped) {
    child.kill("SIGKILL");
    await child.exited;
  }
}

function startRuntime(
  fixture: DiscordSmokeFixture,
  scenario: "gateway" | "bb-transfer",
  databaseUrl: string,
  readyPath: string,
): Bun.Subprocess {
  return Bun.spawn(
    [
      "bun",
      "scripts/dev-discord.ts",
      "--scenario",
      scenario,
      "--database-url",
      databaseUrl,
    ],
    {
      cwd: SCOUT_ROOT,
      env: {
        ...Bun.env,
        SCOUT_DISCORD_SMOKE_GUILD_ID: fixture.guildId,
        SCOUT_DISCORD_SMOKE_READY_PATH: readyPath,
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
}

async function createIsolatedDatabase(runId: string): Promise<{
  readonly prisma: SmokeDatabase;
  readonly dbPath: string;
  readonly dbUrl: string;
}> {
  await ensureTestTemplate();
  sweepStaleTestDatabases();
  return createTestDatabase(`discord_smoke_${runId}`);
}

async function loadPreflightFixture(): Promise<DiscordSmokeFixture> {
  const fixture = await loadDiscordSmokeFixture(FIXTURE_PATH);
  await preflightDiscordSmoke(fixture, Bun.env, {
    fetch,
    verifyPinchTabProfile,
  });
  return fixture;
}

async function prepareFreshRun(
  scenario: "gateway" | "bb-transfer",
): Promise<FreshSmokeRun> {
  const runId = createRunId();
  const manifestPath = path.join(runDirectory(runId), "manifest.json");
  let manifest = createManifest(runId, scenario);
  await writeDiscordSmokeManifest(manifestPath, manifest);
  const database = await createIsolatedDatabase(runId);
  manifest = {
    ...manifest,
    databaseName: database.dbPath,
    databaseUrl: database.dbUrl,
  };
  await writeDiscordSmokeManifest(manifestPath, manifest);
  return { database, manifest, manifestPath, runId };
}

async function closeSmokeDatabase(
  successful: boolean,
  database: SmokeDatabase,
  databaseName: string,
): Promise<void> {
  if (successful) {
    await dropTestDatabase(database, databaseName);
  } else {
    await database.$disconnect();
  }
}

async function verifyAndCaptureTransfer(
  database: SmokeDatabase,
  fixture: DiscordSmokeFixture,
  manifest: DiscordSmokeManifest,
  manifestPath: string,
): Promise<DiscordSmokeManifest> {
  if (manifest.seededAccounts === null) {
    throw new Error(`Smoke run ${manifest.runId} has no seeded accounts`);
  }
  if (manifest.invocationStartedAt === null) {
    throw new Error(`Smoke run ${manifest.runId} has no invocation boundary`);
  }
  await verifyTransferDatabase(database, fixture, manifest.seededAccounts);
  const publicMessageId =
    manifest.publicMessageId ??
    (await findReceiptMessageId(
      fixture,
      requireEnvironment("DISCORD_BOT_TOKEN"),
      manifest.invocationStartedAt,
    ));
  const screenshotPath = await captureReceipt(
    fixture,
    publicMessageId,
    runDirectory(manifest.runId),
  );
  const verifiedManifest = {
    ...manifest,
    publicMessageId,
    verifiedAt: new Date().toISOString(),
    screenshotPath,
  };
  await writeDiscordSmokeManifest(manifestPath, verifiedManifest);
  return verifiedManifest;
}

async function runGatewaySmoke(): Promise<void> {
  const fixture = await loadPreflightFixture();
  const { database, manifestPath, runId, ...prepared } =
    await prepareFreshRun("gateway");
  let { manifest } = prepared;

  let runtime: Bun.Subprocess | null = null;
  let successful = false;
  try {
    const runtimeReadyPath = path.join(
      runDirectory(runId),
      "runtime-ready.json",
    );
    runtime = startRuntime(
      fixture,
      "gateway",
      database.dbUrl,
      runtimeReadyPath,
    );
    await waitForRuntimeReadiness(runtime, runtimeReadyPath);
    await raceRuntimeOperation(
      runtime,
      waitForDiscordCommand({
        fixture,
        botToken: requireEnvironment("DISCORD_BOT_TOKEN"),
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
    await closeSmokeDatabase(successful, database.prisma, database.dbPath);
  }
  console.log(`Discord gateway smoke passed: ${runId}`);
}

async function runTransferSmoke(): Promise<void> {
  const fixture = await loadPreflightFixture();
  const { database, manifestPath, runId, ...prepared } =
    await prepareFreshRun("bb-transfer");
  let { manifest } = prepared;
  const seededAccounts = await seedTransferAccounts(database.prisma, fixture);
  manifest = {
    ...manifest,
    seededAccounts,
  };
  await writeDiscordSmokeManifest(manifestPath, manifest);

  let runtime: Bun.Subprocess | null = null;
  let successful = false;
  try {
    const runtimeReadyPath = path.join(
      runDirectory(runId),
      "runtime-ready.json",
    );
    runtime = startRuntime(
      fixture,
      "bb-transfer",
      database.dbUrl,
      runtimeReadyPath,
    );
    await waitForRuntimeReadiness(runtime, runtimeReadyPath);
    await raceRuntimeOperation(
      runtime,
      waitForDiscordCommand({
        fixture,
        botToken: requireEnvironment("DISCORD_BOT_TOKEN"),
        commandName: "bb",
        subcommandName: "transfer",
        guildScoped: true,
        timeoutMilliseconds: 60_000,
      }),
      "before exposing /bb transfer",
    );
    assertInvocationAllowed(manifest);
    manifest = { ...manifest, invocationStartedAt: new Date().toISOString() };
    await writeDiscordSmokeManifest(manifestPath, manifest);

    const response = await invokeTransfer(
      fixture,
      TOOLKIT_ENTRYPOINT,
      WORKSPACE_ROOT,
    );
    manifest = {
      ...manifest,
      privateReplyId: response.reply?.id ?? null,
      publicMessageId: response.publicResponse?.id ?? null,
    };
    await writeDiscordSmokeManifest(manifestPath, manifest);
    assertTransferResponse(fixture, response);
    await stopChild(runtime);
    runtime = null;
    manifest = await verifyAndCaptureTransfer(
      database.prisma,
      fixture,
      manifest,
      manifestPath,
    );
    successful = true;
  } finally {
    await stopChild(runtime);
    await closeSmokeDatabase(successful, database.prisma, database.dbPath);
  }
  console.log(`Western Union Discord smoke passed: ${runId}`);
}

async function resumeTransferSmoke(runId: string): Promise<void> {
  const fixture = await loadPreflightFixture();
  const manifestPath = path.join(runDirectory(runId), "manifest.json");
  let manifest = await loadDiscordSmokeManifest(manifestPath);
  if (manifest.scenario !== "bb-transfer") {
    throw new Error(`Smoke run ${runId} is not a bb-transfer run`);
  }
  if (
    manifest.databaseName === null ||
    manifest.databaseUrl === null ||
    manifest.seededAccounts === null
  ) {
    throw new Error(`Smoke run ${runId} has no seeded transfer database`);
  }
  const databaseName = manifest.databaseName;
  const database = connectTestDatabase(manifest.databaseUrl);
  let successful = false;
  try {
    manifest = await verifyAndCaptureTransfer(
      database,
      fixture,
      manifest,
      manifestPath,
    );
    successful = true;
  } finally {
    await closeSmokeDatabase(successful, database, databaseName);
  }
  console.log(`Western Union Discord smoke resumed and verified: ${runId}`);
}

if (import.meta.main) {
  const args = parseDiscordSmokeArguments(Bun.argv.slice(2));
  if (args.kind === "resume") {
    await resumeTransferSmoke(args.runId);
  } else if (args.scenario === "bb-transfer") {
    await runTransferSmoke();
  } else {
    await runGatewaySmoke();
  }
}
