import { afterEach, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const temporaryDirectories: string[] = [];
const agentExecPath = path.resolve(
  import.meta.dir,
  "../dot_local/share/agent-bin/executable_agent-exec",
);

const LowercaseUuidSchema = z
  .string()
  .regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u);

const ChildReportSchema = z.object({
  args: z.array(z.string()),
  env: z.record(z.string(), z.string().nullable()),
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const inspectedKeys = [
  "AGENT_CLI",
  "AI_AGENT",
  "AGENT_LAUNCH_ID",
  "GIT_CONFIG_GLOBAL",
  "GH_CONFIG_DIR",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "CURSOR_API_KEY",
  "OP_SERVICE_ACCOUNT_TOKEN",
] as const;

async function createHarness(cliName: string) {
  const root = await mkdtemp(path.join(tmpdir(), "agent-exec-identity-"));
  temporaryDirectories.push(root);
  const homeDir = path.join(root, "home");
  const wrapperDir = path.join(root, "wrapper");
  const binDir = path.join(root, "bin");
  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(wrapperDir, { recursive: true }),
    mkdir(binDir, { recursive: true }),
  ]);

  const copiedAgentExec = path.join(wrapperDir, "agent-exec");
  await Bun.write(copiedAgentExec, await Bun.file(agentExecPath).text());
  await chmod(copiedAgentExec, 0o755);

  // A wrapper sibling of the same name in wrapperDir must be skipped so the
  // real binary in binDir is executed instead of recursing.
  const wrapperSibling = path.join(wrapperDir, cliName);
  await Bun.write(wrapperSibling, "#!/bin/sh\nexit 99\n");
  await chmod(wrapperSibling, 0o755);

  const dummyBinary = path.join(binDir, cliName);
  const bunPath = Bun.which("bun") ?? process.execPath;
  const inspectorScript = path.join(root, "inspect.mjs");
  await Bun.write(
    inspectorScript,
    [
      `const keys = ${JSON.stringify(inspectedKeys)};`,
      "const env = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]));",
      "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), env }));",
      "",
    ].join("\n"),
  );
  await Bun.write(
    dummyBinary,
    `#!/bin/sh\nexec "${bunPath}" "${inspectorScript}" "$@"\n`,
  );
  await chmod(dummyBinary, 0o755);

  const systemPath = [
    wrapperDir,
    binDir,
    "/usr/bin",
    "/bin",
    path.dirname(bunPath),
  ].join(":");

  return {
    homeDir,
    run(extraEnv: Record<string, string> = {}) {
      const result = Bun.spawnSync(
        ["/bin/sh", copiedAgentExec, cliName, "--auto", "--", "hello"],
        {
          env: {
            ...Bun.env,
            HOME: homeDir,
            PATH: systemPath,
            OPENAI_API_KEY: "sk-openai-secret",
            ANTHROPIC_API_KEY: "sk-anthropic-secret",
            CODEX_API_KEY: "sk-codex-secret",
            GEMINI_API_KEY: "sk-gemini-secret",
            GOOGLE_API_KEY: "sk-google-secret",
            XAI_API_KEY: "sk-xai-secret",
            GROK_API_KEY: "sk-grok-secret",
            MOONSHOT_API_KEY: "sk-moonshot-secret",
            KIMI_API_KEY: "sk-kimi-secret",
            CURSOR_API_KEY: "sk-cursor-secret",
            OP_SERVICE_ACCOUNT_TOKEN: "ops-secret",
            ...extraEnv,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `agent-exec exited ${String(result.exitCode)}: ${new TextDecoder().decode(result.stderr)}`,
        );
      }
      return ChildReportSchema.parse(
        JSON.parse(new TextDecoder().decode(result.stdout)),
      );
    },
  };
}

test("exports agent identity, fresh lowercase launch UUIDs, and scrubs API keys and stale GH_CONFIG_DIR", async () => {
  const harness = await createHarness("kimi");
  const first = harness.run({
    AGENT_LAUNCH_ID: "stale-parent-uuid",
    GH_CONFIG_DIR: "/stale/gh-agent",
  });
  const second = harness.run();

  expect(first.args).toEqual(["--auto", "hello"]);
  expect(first.env["AGENT_CLI"]).toBe("kimi");
  expect(first.env["AI_AGENT"]).toBe("kimi");
  expect(first.env["GIT_CONFIG_GLOBAL"]).toBe(
    `${harness.homeDir}/.config/agent/gitconfig`,
  );
  expect(first.env["GH_CONFIG_DIR"]).toBeNull();

  const firstId = LowercaseUuidSchema.parse(first.env["AGENT_LAUNCH_ID"]);
  const secondId = LowercaseUuidSchema.parse(second.env["AGENT_LAUNCH_ID"]);
  expect(firstId).not.toBe("stale-parent-uuid");
  expect(secondId).not.toBe(firstId);

  for (const scrubbed of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CODEX_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "MOONSHOT_API_KEY",
    "KIMI_API_KEY",
    "CURSOR_API_KEY",
    "OP_SERVICE_ACCOUNT_TOKEN",
  ]) {
    expect(first.env[scrubbed]).toBeNull();
  }
});
