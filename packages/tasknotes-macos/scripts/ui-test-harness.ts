import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  const scratch = await mkdtemp(path.join(tmpdir(), "facet-ui-tests-"));
  const fixtureFile = path.resolve(packageRoot, ".build/ui-test-fixture.json");

  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);
  const baseURL = `http://127.0.0.1:${String(port)}`;
  const authToken = crypto.randomUUID();

  await mkdir(path.dirname(fixtureFile), { recursive: true });
  await Bun.write(fixtureFile, JSON.stringify({ address: baseURL, authToken }));

  const runMarker = Bun.env["TASKNOTES_CI_RUN_ID"];
  const markerArgument =
    runMarker === undefined ? [] : [`--tasknotes-server-ci-run=${runMarker}`];

  const server = Bun.spawn(["bun", "run", "src/index.ts", ...markerArgument], {
    cwd: serverPackage,
    env: {
      ...Bun.env,
      AUTH_TOKEN: authToken,
      DATABASE_URL: "",
      HOST: "127.0.0.1",
      PORT: String(port),
      BUGSINK_DSN: "",
      VAULT_PATH: scratch,
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
        const response = await fetch(`${baseURL}/api/health`, {
          headers: { authorization: `Bearer ${authToken}` },
        });
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

  async function seedSyncTasks(today: string): Promise<void> {
    const response = await fetch(`${baseURL}/api/v1/sync`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commands: [
          {
            uuid: crypto.randomUUID(),
            temp_id: "tmp-seed-1",
            command: {
              type: "TaskAdd",
              args: {
                title: "Inspector journey",
                project_id: "",
                description: "Original markdown.",
                due_date: today,
                priority: "P2",
              },
            },
          },
          {
            uuid: crypto.randomUUID(),
            temp_id: "tmp-seed-2",
            command: {
              type: "TaskAdd",
              args: {
                title: "Selection target",
                project_id: "",
                description: "Second note.",
                due_date: today,
                priority: "P4",
              },
            },
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(
        `seeding /api/v1/sync failed with HTTP ${String(response.status)}: ${await response.text()}`,
      );
    }
  }

  let testExitCode = 1;
  try {
    await waitUntilHealthy();
    await seedSyncTasks(localCivilDate(new Date()));

    const selectors =
      (run.testSelectors ?? []).length === 0
        ? ["-only-testing:TaskNotesUITests"]
        : (run.testSelectors ?? []);

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
    await rm(scratch, { recursive: true, force: true });
  }

  return testExitCode;
}
