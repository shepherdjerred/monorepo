import { afterEach, expect, test } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const helperSource = path.resolve(
  import.meta.dir,
  "../macos-file-limits/apply.sh",
);
const installerSource = path.resolve(
  import.meta.dir,
  "../macos-file-limits/install.sh",
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
printf '%s\n' "$*" >> "$MAXFILES_TEST_DIR/calls"
if [[ $# -eq 2 ]]; then
    cat "$MAXFILES_TEST_DIR/limits"
    exit 0
fi
# Simulate a setter that also changes kernel caps, including partial failure.
printf '%s\n' "$3" > "$MAXFILES_TEST_DIR/kern.maxfiles"
printf '%s\n' "$4" > "$MAXFILES_TEST_DIR/kern.maxfilesperproc"
case "$MAXFILES_TEST_MODE" in
    rejected) exit 1 ;;
    noop) exit 0 ;;
    lowered-hard) printf 'maxfiles %s 8192\n' "$3" > "$MAXFILES_TEST_DIR/limits" ;;
    *) printf 'maxfiles %s %s\n' "$3" "$4" > "$MAXFILES_TEST_DIR/limits" ;;
esac
`;

const mockSysctl = String.raw`#!/bin/bash
set -eu
if [[ "$1" == -n ]]; then
    cat "$MAXFILES_TEST_DIR/$2"
    exit 0
fi
printf 'sysctl %s\n' "$2" >> "$MAXFILES_TEST_DIR/calls"
IFS='=' read -r key value <<< "$2"
if [[ "$MAXFILES_TEST_MODE" == restore-failed ]]; then
    exit 1
fi
if [[ "$MAXFILES_TEST_MODE" != restore-noop ]]; then
    printf '%s\n' "$value" > "$MAXFILES_TEST_DIR/$key"
fi
`;

type Scenario = {
  limits?: string;
  kernelMaximum?: string;
  kernelPerProcess?: string;
  mode?: string;
  uid?: string;
};

async function writeFixtures(
  directory: string,
  fixtures: Readonly<Record<string, string>>,
) {
  await Promise.all(
    Object.entries(fixtures).map(async ([name, contents]) => {
      const destination = path.join(directory, name);
      await Bun.write(destination, contents);
      await chmod(destination, 0o700);
    }),
  );
}

async function runHelper(scenario: Scenario = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "maxfiles-test-"));
  temporaryDirectories.push(directory);
  const fixtures = {
    limits: scenario.limits ?? "maxfiles 256 unlimited\n",
    "kern.maxfiles": scenario.kernelMaximum ?? "491520\n",
    "kern.maxfilesperproc": scenario.kernelPerProcess ?? "245760\n",
    calls: "",
    launchctl: mockLaunchctl,
    sysctl: mockSysctl,
    uname: "#!/bin/bash\nprintf 'Darwin\\n'\n",
    id: `#!/bin/bash\nprintf '%s\\n' '${scenario.uid ?? "0"}'\n`,
  };
  await writeFixtures(directory, fixtures);

  // The test copy redirects every OS command; production uses fixed system paths.
  let source = await Bun.file(helperSource).text();
  for (const [systemPath, mockName] of Object.entries({
    "/bin/launchctl": "launchctl",
    "/usr/sbin/sysctl": "sysctl",
    "/usr/bin/uname": "uname",
    "/usr/bin/id": "id",
  })) {
    source = source.replaceAll(systemPath, path.join(directory, mockName));
  }
  const helper = path.join(directory, "apply.sh");
  await Bun.write(helper, source);
  const result = Bun.spawnSync(["/bin/bash", helper], {
    env: {
      ...Bun.env,
      MAXFILES_TEST_DIR: directory,
      MAXFILES_TEST_MODE: scenario.mode ?? "success",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [limits, kernelMaximum, kernelPerProcess, calls] = await Promise.all([
    Bun.file(path.join(directory, "limits")).text(),
    Bun.file(path.join(directory, "kern.maxfiles")).text(),
    Bun.file(path.join(directory, "kern.maxfilesperproc")).text(),
    Bun.file(path.join(directory, "calls")).text(),
  ]);
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    limits: limits.trim(),
    kernelMaximum: kernelMaximum.trim(),
    kernelPerProcess: kernelPerProcess.trim(),
    calls,
  };
}

test("raises the default and restores both kernel caps", async () => {
  const result = await runHelper();
  expect(result.exitCode).toBe(0);
  expect(result.limits).toBe("maxfiles 8192 245760");
  expect(result.kernelMaximum).toBe("491520");
  expect(result.kernelPerProcess).toBe("245760");
  expect(result.stdout).toContain("launchd soft=8192 hard=245760");
});

test("preserves a finite hard limit", async () => {
  const result = await runHelper({ limits: "maxfiles 256 131072\n" });
  expect(result.exitCode).toBe(0);
  expect(result.limits).toBe("maxfiles 8192 131072");
  expect(result.kernelPerProcess).toBe("245760");
});

test.each(["8192", "16384", "unlimited"])(
  "does not lower or rewrite an existing %s soft limit",
  async (soft) => {
    const result = await runHelper({ limits: `maxfiles ${soft} unlimited\n` });
    expect(result.exitCode).toBe(0);
    expect(result.limits).toBe(`maxfiles ${soft} unlimited`);
    expect(
      result.calls
        .trim()
        .split("\n")
        .every((call) => call === "limit maxfiles"),
    ).toBe(true);
    expect(result.kernelMaximum).toBe("491520");
  },
);

test("restores caps even when launchctl fails after partially changing them", async () => {
  const result = await runHelper({ mode: "rejected" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("launchctl refused");
  expect(result.limits).toBe("maxfiles 256 unlimited");
  expect(result.kernelMaximum).toBe("491520");
  expect(result.kernelPerProcess).toBe("245760");
});

test("detects a setter that returns success without changing the limit", async () => {
  const result = await runHelper({ mode: "noop" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("soft limit readback is 256");
  expect(result.kernelMaximum).toBe("491520");
});

test("rejects a setter that lowers the hard limit", async () => {
  const result = await runHelper({
    limits: "maxfiles 256 131072\n",
    mode: "lowered-hard",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("lowered the effective hard limit");
  expect(result.kernelMaximum).toBe("491520");
});

test.each([
  { mode: "restore-failed", message: "cannot restore kern.maxfiles" },
  {
    mode: "restore-noop",
    message: "restoration of kern.maxfiles did not persist",
  },
])(
  "reports $mode rather than claiming the caps were preserved",
  async ({ mode, message }) => {
    const result = await runHelper({ mode });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain("unchanged");
  },
);

test.each([
  "maxfiles 256 4096\n",
  "bad output\n",
  "maxfiles 256 unlimited\nextra\n",
  "",
])(
  "rejects unsafe or malformed limit output %j before mutation",
  async (limits) => {
    const result = await runHelper({ limits });
    expect(result.exitCode).toBe(1);
    expect(result.kernelMaximum).toBe("491520");
    expect(result.calls).not.toContain("limit maxfiles 8192");
  },
);

test("rejects a kernel ceiling below the minimum even for an unlimited soft limit", async () => {
  const result = await runHelper({
    limits: "maxfiles unlimited unlimited\n",
    kernelPerProcess: "4096\n",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("existing kernel file ceiling");
  expect(result.calls).toBe("");
});

test("requires admin access before issuing any system commands that change limits", async () => {
  const result = await runHelper({ uid: "501" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("must run as root");
  expect(result.calls).toBe("");
});

const mockInstallerLaunchctl = String.raw`#!/bin/bash
set -eu
printf '%s\n' "$*" >> "$MAXFILES_TEST_DIR/calls"
case "$1" in
    print)
        [[ -f "$MAXFILES_TEST_DIR/loaded" ]] || exit 1
        count="$(cat "$MAXFILES_TEST_DIR/polls")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$MAXFILES_TEST_DIR/polls"
        if ((count == 1)) || [[ "$MAXFILES_TEST_MODE" == pending ]]; then
            printf 'state = running\nlast exit code = (never exited)\n'
        else
            printf 'state = not running\nlast exit code = %s\n' "$MAXFILES_TEST_MODE"
        fi
        ;;
    bootstrap)
        touch "$MAXFILES_TEST_DIR/loaded"
        printf '0\n' > "$MAXFILES_TEST_DIR/polls"
        ;;
    limit) printf 'maxfiles 8192 unlimited\n' ;;
    *) exit 1 ;;
esac
`;

const mockInstall = `#!/bin/bash
set -eu
directory=0
while [[ "$1" == -* ]]; do
    case "$1" in
        -d) directory=1; shift ;;
        -m|-o|-g) shift 2 ;;
        *) exit 1 ;;
    esac
done
if ((directory)); then
    /bin/mkdir -p "$1"
else
    /bin/cp "$1" "$2"
fi
`;

async function runInstaller(exitCode = "0") {
  const directory = await mkdtemp(
    path.join(tmpdir(), "maxfiles-installer-test-"),
  );
  temporaryDirectories.push(directory);
  const fixtures = {
    calls: "",
    launchctl: mockInstallerLaunchctl,
    install: mockInstall,
    stat: String.raw`#!/bin/bash
if [[ "$3" == *.plist ]]; then
    printf '0:0:644\n'
else
    printf '0:0:755\n'
fi
`,
    uname: "#!/bin/bash\nprintf 'Darwin\\n'\n",
    id: "#!/bin/bash\nprintf '0\\n'\n",
    sleep: "#!/bin/bash\nexit 0\n",
    "apply.sh": await Bun.file(helperSource).text(),
    "com.jerred.maxfiles.plist": await Bun.file(
      path.resolve(path.dirname(helperSource), "com.jerred.maxfiles.plist"),
    ).text(),
  };
  await writeFixtures(directory, fixtures);

  // All privileged actions are redirected to fixtures inside this temporary directory.
  let source = await Bun.file(installerSource).text();
  for (const [systemPath, fixturePath] of Object.entries({
    "/bin/launchctl": "launchctl",
    "/usr/bin/install": "install",
    "/usr/bin/stat": "stat",
    "/usr/bin/uname": "uname",
    "/usr/bin/id": "id",
    "/bin/sleep": "sleep",
    "/usr/local": "usr/local",
    "/Library/LaunchDaemons": "Library/LaunchDaemons",
  })) {
    source = source.replaceAll(systemPath, path.join(directory, fixturePath));
  }
  const installer = path.join(directory, "install.sh");
  await Bun.write(installer, source);
  const result = Bun.spawnSync(["/bin/bash", installer], {
    env: {
      ...Bun.env,
      MAXFILES_TEST_DIR: directory,
      MAXFILES_TEST_MODE: exitCode,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    calls: await Bun.file(path.join(directory, "calls")).text(),
  };
}

test("waits for the boot helper's first exit before reporting installation success", async () => {
  const result = await runInstaller();
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Installed and loaded: launchd soft=8192");
});

test.each(["1", "78: EX_CONFIG"])(
  "reports a completed boot helper failure with exit status %s",
  async (exitCode) => {
    const result = await runInstaller(exitCode);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boot helper failed");
    expect(result.stdout).not.toContain("Installed and loaded");
  },
);

test("times out when the boot helper never exits", async () => {
  const result = await runInstaller("pending");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "boot helper did not finish within 15 seconds",
  );
});
