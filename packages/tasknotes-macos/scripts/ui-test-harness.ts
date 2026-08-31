import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The environment the UI suite needs in order to run at all.
 *
 * `InspectorEditingUITests` reads `.build/ui-test-fixture.json` to find the
 * server and vault it should drive. Nothing creates that file except this
 * harness, so a runner that skips the bootstrap does not merely lose the
 * seeded data — that suite fails outright with NSCocoaErrorDomain 260, and
 * takes sibling suites down with it.
 *
 * This exists because the local and CI runners had drifted: the local one did
 * the whole bootstrap and CI shelled straight into xcodebuild, so the suite
 * could never pass there. Both now go through this function, which is what
 * stops them drifting again.
 */
export type UiTestRun = {
  /** Extra xcodebuild arguments; CI passes the signing identity. */
  extraArguments?: readonly string[];
  /** `-only-testing:` selectors. Defaults to the whole UI suite. */
  testSelectors?: readonly string[];
};

const packageRoot = path.resolve(import.meta.dir, "..");
const serverPackage = path.resolve(packageRoot, "../tasknotes-server");

function localCivilDate(now: Date): string {
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function runUiTests(run: UiTestRun): Promise<number> {
  const vault = await mkdtemp(path.join(tmpdir(), "tasknotes-ui-tests-"));
  const fixtureFile = path.resolve(packageRoot, ".build/ui-test-fixture.json");

  // Reserve a free port by binding and immediately releasing it, so the
  // fixture and the server agree on the address before either is used.
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
    throw new Error(
      "tasknotes-server did not become healthy within 10 seconds",
    );
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
    const today = localCivilDate(new Date());
    await seedTask("Inspector journey", today, "Original markdown.");
    await seedTask("Selection target", today, "Second note.");

    const selectors =
      run.testSelectors === undefined || run.testSelectors.length === 0
        ? ["-only-testing:TaskNotesUITests"]
        : run.testSelectors;

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
        ...selectors,
        ...(run.extraArguments ?? []),
      ],
      {
        cwd: packageRoot,
        env: Bun.env,
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    testExitCode = await tests.exited;
  } finally {
    server.kill();
    await server.exited;
    await rm(fixtureFile, { force: true });
    await rm(vault, { recursive: true, force: true });
  }

  return testExitCode;
}
