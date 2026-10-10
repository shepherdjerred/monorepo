import { afterEach, describe, expect, test } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isCredentialFreePassthrough } from "#lib/passthrough.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

async function invokeWithCredentialSentinel(args: readonly string[]) {
  const directory = await mkdtemp(path.join(tmpdir(), "toolkit-metadata-"));
  temporaryDirectories.push(directory);
  const credentialsPath = path.resolve(
    import.meta.dir,
    "../../src/lib/credentials.ts",
  );
  const preloadPath = path.join(directory, "credential-sentinel.ts");
  // The actual command-to-credential mapping remains in use. Only the
  // resolver is replaced, before the real CLI entrypoint is imported.
  await Bun.write(
    preloadPath,
    String.raw`import { plugin } from "bun";
import { requiredCredentialsFor } from ${JSON.stringify(credentialsPath)};
plugin({
  name: "credential-resolver-sentinel",
  setup(build) {
    build.onResolve({ filter: /^#lib\/credentials\.ts$/ }, () => ({
      path: "credentials",
      namespace: "credential-sentinel",
    }));
    build.onLoad({ filter: /^credentials$/, namespace: "credential-sentinel" }, () => ({
      loader: "object",
      exports: {
        requiredCredentialsFor,
        resolveCredentials(names) {
          throw new Error("credential-resolver-sentinel:" + names.join(","));
        },
      },
    }));
  },
});
`,
  );
  for (const executable of ["woodpecker-cli", "gcx", "argocd"]) {
    const executablePath = path.join(directory, executable);
    await Bun.write(
      executablePath,
      `#!/bin/sh
printf 'native args:'
for arg in "$@"; do printf '<%s>' "$arg"; done
printf '\n'
printf 'native error\n' >&2
exit 23
`,
    );
    await chmod(executablePath, 0o755);
  }
  const entrypoint = path.resolve(import.meta.dir, "../../src/index.ts");
  const child = Bun.spawn(
    [process.execPath, "--preload", preloadPath, entrypoint, ...args],
    {
      env: { PATH: directory },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

describe("native metadata credential boundary", () => {
  test.each([
    [["woodpecker", "--version"], ["--version"]],
    [["woodpecker", "--help"], ["--help"]],
    [["woodpecker", "-h"], ["-h"]],
    [
      ["grafana", "--version"],
      ["--context", "homelab", "--version"],
    ],
    [
      ["prom", "--help"],
      ["--context", "homelab", "metrics", "--help"],
    ],
    [
      ["loki", "--help"],
      ["--context", "homelab", "logs", "--help"],
    ],
    [
      ["tempo", "--help"],
      ["--context", "homelab", "traces", "--help"],
    ],
    [
      ["argocd", "version", "--client"],
      ["--grpc-web", "version", "--client"],
    ],
    [
      ["argocd", "app", "rollback", "--help"],
      ["--grpc-web", "app", "rollback", "--help"],
    ],
    [
      ["argocd", "account", "generate-token", "-h"],
      ["--grpc-web", "account", "generate-token", "-h"],
    ],
  ])("forwards %j without invoking the resolver", async (args, nativeArgs) => {
    const result = await invokeWithCredentialSentinel(args);
    expect(result.code).toBe(23);
    expect(result.stdout).toBe(
      `native args:${nativeArgs.map((arg) => `<${arg}>`).join("")}\n`,
    );
    expect(result.stderr).toBe("native error\n");
  });

  test.each([
    [["woodpecker", "pipeline", "ls"], "WOODPECKER_TOKEN"],
    [["woodpecker", "-v"], "WOODPECKER_TOKEN"],
    [["woodpecker", "pipeline", "--version"], "WOODPECKER_TOKEN"],
    [["woodpecker", "--", "--help"], "WOODPECKER_TOKEN"],
    [["grafana", "dashboards", "--version"], "GRAFANA_API_KEY"],
    [["prom", "query", "--", "--help"], "GRAFANA_API_KEY"],
    [["loki", "query", "--help"], "GRAFANA_API_KEY"],
    [["tempo", "query", "--version"], "GRAFANA_API_KEY"],
    [["argocd", "version"], "ARGOCD_AUTH_TOKEN"],
    [["argocd", "version", "--client=false"], "ARGOCD_AUTH_TOKEN"],
    [["argocd", "version", "--", "--client"], "ARGOCD_AUTH_TOKEN"],
    [["argocd", "app", "list", "--client"], "ARGOCD_AUTH_TOKEN"],
    [["argocd", "app", "list", "--", "--help"], "ARGOCD_AUTH_TOKEN"],
    [
      ["argocd", "app", "set", "example", "--parameter", "--help"],
      "ARGOCD_AUTH_TOKEN",
    ],
    [["pr", "--help"], "WOODPECKER_TOKEN"],
  ])("retains credential resolution for %j", async (args, credential) => {
    const result = await invokeWithCredentialSentinel(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `credential-resolver-sentinel:${credential}`,
    );
    expect(result.stderr).not.toContain("native error");
  });

  test("recognizes only complete registered native metadata invocations", () => {
    for (const args of [
      [],
      ["--version", ""],
      ["--help", "query"],
      ["--", "-h"],
    ]) {
      expect(isCredentialFreePassthrough("woodpecker", args)).toBe(false);
    }
    expect(isCredentialFreePassthrough("pr", ["--help"])).toBe(false);
    expect(isCredentialFreePassthrough("unknown", ["--version"])).toBe(false);
  });
});
