import { afterEach, expect, test } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const wrapperPath = path.resolve(import.meta.dir, "with-service-account.sh");
const fakeToken = `ops_eyJ${"A".repeat(160)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runWrapper(options: {
  readonly keychainVisible: boolean;
  readonly herdrCoreState: "absent" | "stopped" | "running" | "background";
  readonly delegatedEnv?: string;
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "sa-wrapper-test-"));
  temporaryDirectories.push(directory);
  const callsFile = path.join(directory, "calls.log");
  await Bun.write(callsFile, "");

  const fixtures: Record<string, string> = {
    uname: "#!/bin/bash\nprintf 'Darwin\\n'\n",
    id: "#!/bin/bash\nprintf 'jerred\\n'\n",
    launchctl: "#!/bin/bash\nprintf 'Background\\n'\n",
    security: options.keychainVisible
      ? String.raw`#!/bin/bash
if [[ "$1" == "list-keychains" ]]; then
  printf '    "/Users/jerred/Library/Keychains/login.keychain-db"\n'
  exit 0
fi
exit 44
`
      : String.raw`#!/bin/bash
if [[ "$1" == "list-keychains" ]]; then
  printf '    "/Library/Keychains/System.keychain"\n'
  exit 0
fi
exit 44
`,
    probe: String.raw`#!/bin/bash
set -eu
printf 'token_len=%s\n' "$(printf '%s' "$OP_SERVICE_ACCOUNT_TOKEN" | wc -c | tr -d ' ')"
`,
  };

  if (options.herdrCoreState !== "absent") {
    fixtures["herdr-core"] = String.raw`#!/bin/bash
set -eu
printf 'herdr-core %s\n' "$*" >> "$WRAPPER_TEST_CALLS"
if [[ "$1 $2" == "server status" ]]; then
  [[ "${options.herdrCoreState}" != "stopped" ]]
  exit $?
fi
if [[ "$1" == "exec" ]]; then
  [[ "${options.herdrCoreState}" == "running" ]] || exit 44
  printf '%s\n' '${fakeToken}'
  exit 0
fi
exit 91
`;
  }

  await Promise.all(
    Object.entries(fixtures).map(async ([name, contents]) => {
      const target = path.join(directory, name);
      await Bun.write(target, contents);
      await chmod(target, 0o700);
    }),
  );

  const env: Record<string, string> = {
    HOME: directory,
    PATH: `${directory}:/usr/bin:/bin`,
    HERDR_CORE_BIN: path.join(directory, "herdr-core"),
    WRAPPER_TEST_CALLS: callsFile,
  };
  if (options.delegatedEnv !== undefined) {
    env["WITH_SERVICE_ACCOUNT_GUI_DELEGATED"] = options.delegatedEnv;
  }

  const result = Bun.spawnSync(
    ["/bin/bash", wrapperPath, path.join(directory, "probe")],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    calls: await Bun.file(callsFile).text(),
  };
}

test("reads the enrolled token through a running Herdr core when in a Background session", async () => {
  const result = await runWrapper({
    keychainVisible: false,
    herdrCoreState: "running",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`token_len=${String(fakeToken.length)}\n`);
  expect(result.stderr).toBe("");
  expect(result.calls).toContain("herdr-core server status --json\n");
  expect(result.calls).toContain(
    "herdr-core exec --env WITH_SERVICE_ACCOUNT_GUI_DELEGATED=1 /usr/bin/security find-generic-password -a jerred -s monorepo-homelab-1password-service-account -w\n",
  );
});

test("does not invoke herdr-core exec when the core server is stopped", async () => {
  const result = await runWrapper({
    keychainVisible: false,
    herdrCoreState: "stopped",
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls).toBe("herdr-core server status --json\n");
  expect(result.stderr).toContain(
    "This process cannot see the login Keychain (launchd session: Background), so the enrolled token looks missing; do not re-enroll.",
  );
});

test("does not recurse when already delegated", async () => {
  const result = await runWrapper({
    keychainVisible: false,
    herdrCoreState: "running",
    delegatedEnv: "1",
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls).toBe("");
});

test("reports missing Keychain item when login.keychain is visible", async () => {
  const result = await runWrapper({
    keychainVisible: true,
    herdrCoreState: "running",
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls).toBe("");
  expect(result.stderr).toBe(
    "No homelab 1Password service account token is available in Keychain.\n",
  );
});
