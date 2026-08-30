import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const serverPackage = path.resolve(import.meta.dir, "../../tasknotes-server");
const vault = await mkdtemp(path.join(tmpdir(), "tasknotes-ui-tests-"));
const fixtureFile = path.resolve(
  import.meta.dir,
  "../.build/ui-test-fixture.json",
);
const requestedTests = Bun.argv.slice(2);
const testSelectors =
  requestedTests.length === 0
    ? ["-only-testing:TaskNotesUITests"]
    : requestedTests.map((test) => `-only-testing:${test}`);

const reservation = Bun.serve({
  port: 0,
  fetch: () => new Response("reserved"),
});
const port = reservation.port;
await reservation.stop(true);

const baseURL = `http://127.0.0.1:${String(port)}`;
await mkdir(path.dirname(fixtureFile), { recursive: true });
await Bun.write(fixtureFile, JSON.stringify({ address: baseURL, vault }));
const server = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: serverPackage,
  env: {
    ...Bun.env,
    AUTH_TOKEN: "",
    PORT: String(port),
    SENTRY_DSN: "",
    TASKS_DIR: "TaskNotes",
    VAULT_PATH: vault,
  },
  stdout: "inherit",
  stderr: "inherit",
});

async function waitUntilHealthy(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(
        `tasknotes-server exited before the UI journey started with status ${String(server.exitCode)}`,
      );
    }
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error("tasknotes-server did not become healthy within 10 seconds");
}

async function seedTask(
  title: string,
  scheduled: string,
  details: string,
): Promise<void> {
  const response = await fetch(`${baseURL}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, scheduled, details }),
  });
  if (response.status !== 201) {
    throw new Error(
      `seeding ${title} failed with HTTP ${String(response.status)}: ${await response.text()}`,
    );
  }
}

let testExitCode = 1;
try {
  await waitUntilHealthy();
  const today = new Date().toISOString().slice(0, 10);
  await seedTask("Inspector journey", today, "Original markdown.");
  await seedTask("Selection target", today, "Second note.");

  const tests = Bun.spawn(
    [
      "xcodebuild",
      "test",
      "-project",
      "TaskNotes.xcodeproj",
      "-scheme",
      "TaskNotes",
      "-configuration",
      "Debug",
      "-derivedDataPath",
      ".build/xcode",
      "-destination",
      "platform=macOS",
      ...testSelectors,
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: Bun.env,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  testExitCode = await tests.exited;
} finally {
  server.kill();
  await server.exited;
  await rm(fixtureFile);
  await rm(vault, { recursive: true });
}

process.exit(testExitCode);
