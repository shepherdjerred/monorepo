import { afterEach, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const helperSource = path.resolve(
  import.meta.dir,
  "../.chezmoitemplates/launchagent-reload.sh",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const mockLaunchctl = String.raw`#!/bin/bash
set -eu
printf '%s\n' "$*" >> "$LAUNCHAGENT_TEST_DIR/calls"
case "$1" in
    print)
        if [[ "$2" == gui/501 ]]; then
            [[ "$LAUNCHAGENT_TEST_MODE" != no-gui ]]
        else
            [[ -f "$LAUNCHAGENT_TEST_DIR/loaded" ]]
        fi
        ;;
    bootout)
        [[ "$LAUNCHAGENT_TEST_MODE" != bootout-failed ]] || exit 5
        rm "$LAUNCHAGENT_TEST_DIR/loaded"
        ;;
    bootstrap)
        [[ "$LAUNCHAGENT_TEST_MODE" != bootstrap-failed ]] || exit 5
        [[ ! -f "$LAUNCHAGENT_TEST_DIR/loaded" ]] || exit 5
        if [[ "$LAUNCHAGENT_TEST_MODE" != missing-after-bootstrap ]]; then
            touch "$LAUNCHAGENT_TEST_DIR/loaded"
        fi
        ;;
    list) exit 90 ;; # The caller's SSH domain must never be used.
    *) exit 91 ;;
esac
`;

async function runHelper(mode = "success", loaded = true) {
  const directory = await mkdtemp(path.join(tmpdir(), "launchagent-test-"));
  temporaryDirectories.push(directory);
  const launchAgents = path.join(directory, "Library/LaunchAgents");
  await mkdir(launchAgents, { recursive: true });
  const fixtures = {
    calls: "",
    launchctl: mockLaunchctl,
    id: "#!/bin/bash\nprintf '501\\n'\n",
    program: "#!/bin/bash\nexit 0\n",
    plutil: String.raw`#!/bin/bash
set -eu
printf '%s\n' "$*" >> "$LAUNCHAGENT_TEST_DIR/calls"
[[ "$LAUNCHAGENT_TEST_MODE" != invalid-plist ]]
`,
  };
  await Promise.all(
    Object.entries(fixtures).map(async ([name, contents]) => {
      const destination = path.join(directory, name);
      await Bun.write(destination, contents);
      await chmod(destination, 0o700);
    }),
  );
  if (loaded) await Bun.write(path.join(directory, "loaded"), "");
  await Bun.write(path.join(launchAgents, "com.test.agent.plist"), "fixture");
  const source = await Bun.file(helperSource).text();
  const helper = path.join(directory, "run.sh");
  await Bun.write(
    helper,
    `#!/bin/bash\nset -euo pipefail\n${source}\nreload_agent com.test.agent program\n`,
  );
  const result = Bun.spawnSync(["/bin/bash", helper], {
    env: {
      ...Bun.env,
      HOME: directory,
      PATH: `${directory}:/usr/bin:/bin`,
      LAUNCHAGENT_TEST_DIR: directory,
      LAUNCHAGENT_TEST_MODE: mode,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    calls: await Bun.file(path.join(directory, "calls")).text(),
  };
}

test("replaces an agent in the GUI domain even from a different caller domain", async () => {
  const result = await runHelper();
  expect(result.exitCode).toBe(0);
  expect(result.calls).toContain("bootout gui/501/com.test.agent\n");
  expect(result.calls).toContain("bootstrap gui/501 ");
  expect(result.calls.trim().endsWith("print gui/501/com.test.agent")).toBe(
    true,
  );
  expect(result.calls.split("\n")).not.toContain("list");
});

test("loads an absent agent without attempting bootout", async () => {
  const result = await runHelper("success", false);
  expect(result.exitCode).toBe(0);
  expect(result.calls).not.toContain("bootout");
  expect(result.calls).toContain("bootstrap gui/501 ");
});

test("reports a missing GUI session before changing agents", async () => {
  const result = await runHelper("no-gui");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("gui/501 is unavailable");
  expect(result.calls).toBe("print gui/501\n");
});

test("validates the replacement before unloading the installed agent", async () => {
  const result = await runHelper("invalid-plist");
  expect(result.exitCode).toBe(1);
  expect(result.calls).not.toContain("bootout");
  expect(result.calls).not.toContain("bootstrap");
});

test.each(["bootout", "bootstrap"])(
  "preserves a %s failure and identifies the exact agent and domain",
  async (operation) => {
    const result = await runHelper(`${operation}-failed`);
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain(
      `LaunchAgent com.test.agent: ${operation} failed in gui/501 (exit 5)`,
    );
    if (operation === "bootout") {
      expect(result.calls).not.toContain("bootstrap");
    }
  },
);

test("fails if bootstrap succeeds without registering the job", async () => {
  const result = await runHelper("missing-after-bootstrap");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "registration readback failed for gui/501/com.test.agent (exit 1)",
  );
});
