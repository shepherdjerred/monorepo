import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPassthroughInvocation } from "#lib/passthrough.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

function invocation(command: string, args: readonly string[] = []) {
  const result = buildPassthroughInvocation(command, args, {});
  if (result === null) {
    throw new Error(`No passthrough registered for ${command}`);
  }
  return result;
}

describe("passthrough registry", () => {
  test.each([
    ["gh", "gh", []],
    ["bk", "bk", []],
    ["git-spice", "git-spice", []],
    ["linear", "linear", ["--workspace", "sjerred"]],
    ["posthog", "posthog-cli", []],
    ["grafana", "gcx", ["--context", "homelab"]],
    ["prom", "gcx", ["--context", "homelab", "metrics"]],
    ["loki", "gcx", ["--context", "homelab", "logs"]],
    ["tempo", "gcx", ["--context", "homelab", "traces"]],
    ["temporal", "temporal", ["--profile", "homelab"]],
    ["argocd", "argocd", ["--grpc-web"]],
    ["cf", "cf", []],
    ["tailscale", "tailscale", []],
  ])("maps %s to %s", (command, executable, expectedArgs) => {
    const result = invocation(command);
    expect(result.executable).toBe(executable);
    expect(result.args).toEqual(expectedArgs);
  });

  test("injects environment defaults", () => {
    expect(invocation("gh").env["GH_REPO"]).toBe("shepherdjerred/monorepo");
    expect(invocation("bk").env["BUILDKITE_ORGANIZATION_SLUG"]).toBe("sjerred");
    expect(invocation("posthog").env["POSTHOG_CLI_PROJECT_ID"]).toBe("549883");
    expect(invocation("argocd").env["ARGOCD_SERVER"]).toBe(
      "argocd.tailnet-1a49.ts.net",
    );
  });

  test("explicit flags override argument defaults", () => {
    expect(
      invocation("linear", ["--workspace", "other", "issue"]).args,
    ).toEqual(["--workspace", "other", "issue"]);
    expect(invocation("prom", ["--context=other", "query", "up"]).args).toEqual(
      ["metrics", "--context=other", "query", "up"],
    );
    expect(
      invocation("temporal", ["--profile", "other", "workflow"]).args,
    ).toEqual(["--profile", "other", "workflow"]);
    expect(
      invocation("argocd", ["--grpc-web=false", "app", "list"]).args,
    ).toEqual(["--grpc-web=false", "app", "list"]);
  });

  test.each([
    ["grafana", ["--context=other", "dashboards", "list"]],
    ["prom", ["metrics", "--context=other", "query", "up"]],
    ["loki", ["logs", "--context=other", "query", "{}"]],
    ["tempo", ["traces", "--context=other", "query", "trace-id"]],
  ])("an explicit context overrides the %s default", (command, expected) => {
    const userArgs = expected.slice(command === "grafana" ? 0 : 1);
    expect(invocation(command, userArgs).args).toEqual(expected);
  });

  test("explicit environment values and flags override environment defaults", () => {
    const ghEnv = buildPassthroughInvocation("gh", [], {
      GH_REPO: "owner/repo",
    });
    const posthogEnv = buildPassthroughInvocation("posthog", [], {
      POSTHOG_CLI_PROJECT_ID: "123",
    });
    const ghFlag = buildPassthroughInvocation(
      "gh",
      ["--repo", "owner/repo"],
      {},
    );
    const argocdFlag = buildPassthroughInvocation(
      "argocd",
      ["--server=other.example", "app", "list"],
      {},
    );
    const temporalEnv = buildPassthroughInvocation("temporal", ["workflow"], {
      TEMPORAL_ADDRESS: "temporal.example:7233",
    });
    const buildkiteEnv = buildPassthroughInvocation("bk", [], {
      BUILDKITE_ORGANIZATION_SLUG: "other-org",
    });
    const argocdEnv = buildPassthroughInvocation("argocd", [], {
      ARGOCD_SERVER: "other.example",
    });
    expect(ghEnv?.env["GH_REPO"]).toBe("owner/repo");
    expect(posthogEnv?.env["POSTHOG_CLI_PROJECT_ID"]).toBe("123");
    expect(ghFlag?.env["GH_REPO"]).toBeUndefined();
    expect(
      buildPassthroughInvocation("gh", ["-Rowner/repo", "pr", "view"], {})?.env[
        "GH_REPO"
      ],
    ).toBeUndefined();
    expect(argocdFlag?.env["ARGOCD_SERVER"]).toBeUndefined();
    expect(temporalEnv?.args).toEqual(["workflow"]);
    expect(buildkiteEnv?.env["BUILDKITE_ORGANIZATION_SLUG"]).toBe("other-org");
    expect(argocdEnv?.env["ARGOCD_SERVER"]).toBe("other.example");
  });

  test("does not treat tokens after -- as default overrides", () => {
    expect(
      invocation("linear", ["issue", "--", "--workspace", "literal"]).args,
    ).toEqual([
      "--workspace",
      "sjerred",
      "issue",
      "--",
      "--workspace",
      "literal",
    ]);
  });

  test("forwards Temporal root help and version flags without a profile", () => {
    expect(invocation("temporal", ["--help"]).args).toEqual(["--help"]);
    expect(invocation("temporal", ["--version"]).args).toEqual(["--version"]);
    expect(invocation("temporal", ["workflow", "--help"]).args).toEqual([
      "--profile",
      "homelab",
      "workflow",
      "--help",
    ]);
  });

  test("preserves every user argument after the fixed prefix", () => {
    const args = ["query", "a b", "", "--", "--literal"];
    expect(invocation("loki", args).args).toEqual([
      "--context",
      "homelab",
      "logs",
      ...args,
    ]);
  });

  test("returns null for non-platform commands", () => {
    expect(buildPassthroughInvocation("history", [], {})).toBeNull();
    expect(buildPassthroughInvocation("gf", [], {})).toBeNull();
  });
});

type ToolkitResult = {
  readonly code: number;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

async function fakePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "toolkit-passthrough-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeExecutable(
  directory: string,
  name: string,
  source: string,
): Promise<void> {
  const executablePath = path.join(directory, name);
  await Bun.write(executablePath, source);
  await chmod(executablePath, 0o755);
}

async function runToolkit(
  directory: string,
  args: readonly string[],
  stdin: string,
  includeSystemPath = true,
): Promise<ToolkitResult> {
  const entrypoint = path.resolve(import.meta.dir, "../../src/index.ts");
  const child = Bun.spawn([process.execPath, entrypoint, ...args], {
    env: {
      ...Bun.env,
      PATH: includeSystemPath ? `${directory}:/usr/bin:/bin` : directory,
      FAKE_MARKER: "from-environment",
      FAKE_EXIT_CODE: "23",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.stdin.write(stdin);
  await child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, signalCode: child.signalCode, stdout, stderr };
}

describe("passthrough subprocess", () => {
  test("inherits streams and environment, preserves args, and mirrors exit code", async () => {
    const directory = await fakePath();
    await writeExecutable(
      directory,
      "gh",
      `#!/bin/sh
printf 'args:'
for arg in "$@"; do printf '<%s>' "$arg"; done
printf '\nrepo:%s\nmarker:%s\n' "$GH_REPO" "$FAKE_MARKER"
cat
printf 'fake stderr\n' >&2
exit "$FAKE_EXIT_CODE"
`,
    );

    const result = await runToolkit(
      directory,
      ["gh", "pr", "view", "a b", "--", "--literal"],
      "from stdin\n",
    );
    expect(result.code).toBe(23);
    expect(result.signalCode).toBeNull();
    expect(result.stdout).toBe(
      "args:<pr><view><a b><--><--literal>\nrepo:shepherdjerred/monorepo\nmarker:from-environment\nfrom stdin\n",
    );
    expect(result.stderr).toBe("fake stderr\n");
  });

  test("reports a missing executable with exit 127", async () => {
    const directory = await fakePath();
    const result = await runToolkit(directory, ["cf"], "", false);
    expect(result.code).toBe(127);
    expect(result.stderr).toBe("toolkit: required executable not found: cf\n");
  });

  test("mirrors child signal termination", async () => {
    const directory = await fakePath();
    await writeExecutable(directory, "tailscale", "#!/bin/sh\nkill -TERM $$\n");
    const result = await runToolkit(directory, ["tailscale"], "");
    expect(result.code).toBe(143);
    expect(result.signalCode).toBe("SIGTERM");
  });

  test("forwards a parent signal to the child and terminates with it", async () => {
    const directory = await fakePath();
    await writeExecutable(
      directory,
      "tailscale",
      String.raw`#!/bin/sh
trap 'printf "received\n"; exit 0' TERM
printf "ready\n"
while :; do sleep 1; done
`,
    );
    const entrypoint = path.resolve(import.meta.dir, "../../src/index.ts");
    const child = Bun.spawn([process.execPath, entrypoint, "tailscale"], {
      env: { ...Bun.env, PATH: `${directory}:/usr/bin:/bin` },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    while (!stdout.includes("ready\n")) {
      const read = await Promise.race([
        reader.read(),
        Bun.sleep(5000).then(() => {
          throw new Error("Timed out waiting for the passthrough child");
        }),
      ]);
      if (read.done) {
        throw new Error("Passthrough child exited before announcing readiness");
      }
      stdout += decoder.decode(read.value, { stream: true });
    }
    child.kill("SIGTERM");
    while (true) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      stdout += decoder.decode(read.value, { stream: true });
    }
    stdout += decoder.decode();
    const exitCode = await child.exited;
    expect(stdout).toContain("ready");
    expect(stdout).toContain("received");
    expect(exitCode).toBe(143);
    expect(child.signalCode).toBe("SIGTERM");
  });

  for (const args of [["gf"], ["pr", "logs"], ["pr", "detect"]]) {
    test(`rejects removed command ${args.join(" ")}`, async () => {
      const directory = await fakePath();
      const result = await runToolkit(directory, args, "");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown");
    });
  }
});
