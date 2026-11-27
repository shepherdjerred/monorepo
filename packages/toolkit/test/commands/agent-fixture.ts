import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const fakeHc = String.raw`#!${process.execPath}
import { appendFile } from "node:fs/promises";
const args = process.argv.slice(2);
await appendFile(process.env.AGENT_TEST_CALLS, JSON.stringify({ args, terminal: process.env.HC_TERMINAL_ID ?? null })+"\n");
const key = args.slice(0, args[0] === "get" ? 2 : 1).join(" ");
const response = JSON.parse(process.env.AGENT_TEST_RESPONSES)[key];
if (response === undefined) throw new Error("Unexpected hc call");
process.stdout.write(JSON.stringify(response.body ?? {}));
process.stderr.write(response.stderr ?? "");
process.exit(response.code ?? 0);
`;

const commandPath = path.resolve(
  import.meta.dir,
  "../../src/commands/agent.ts",
);
const runner = `import { handleAgentCommand } from ${JSON.stringify(commandPath)};
try { await handleAgentCommand(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
`;

export type Response = { body?: unknown; stderr?: string; code?: number };
const CallSchema = z.object({
  args: z.array(z.string()),
  terminal: z.string().nullable(),
});

/** Each invocation gets its own real hc executable and process environment. */
export async function runAgent(
  args: string[],
  responses: Record<string, Response> = {},
  terminal: string | null = "t7p",
) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-command-test-"));
  try {
    const executable = path.join(directory, "hc");
    const command = path.join(directory, "command.ts");
    const calls = path.join(directory, "calls.jsonl");
    await writeFile(executable, fakeHc);
    await chmod(executable, 0o755);
    await writeFile(command, runner);
    await writeFile(calls, "");
    const child = Bun.spawn([process.execPath, command, ...args], {
      env: {
        ...Bun.env,
        PATH: `${directory}${path.delimiter}${Bun.env["PATH"] ?? ""}`,
        HC_TERMINAL_ID: terminal ?? undefined,
        AGENT_TEST_CALLS: calls,
        AGENT_TEST_RESPONSES: JSON.stringify(responses),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      child.stdout.text(),
      child.stderr.text(),
    ]);
    const callLog = await readFile(calls, "utf8");
    const recorded = callLog
      .split("\n")
      .filter(Boolean)
      .map((line) => CallSchema.parse(JSON.parse(line)));
    return { code, stdout, stderr, calls: recorded };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
