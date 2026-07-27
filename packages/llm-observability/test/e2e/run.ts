import { waitForTempo } from "./run-core.ts";

const root = import.meta.dir.replace(/\/test\/e2e$/, "");
const compose = ["docker", "compose", "-f", "test/e2e/compose.yaml"];

async function run(command: string[]): Promise<void> {
  const subprocess = Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

async function main(): Promise<void> {
  try {
    await run([...compose, "up", "-d", "--wait", "minio"]);
    await run([...compose, "up", "-d", "tempo"]);
    await waitForTempo(async () => {
      const response = await fetch("http://localhost:3200/ready").catch(
        () => null,
      );
      return response?.ok === true;
    });
    await run([...compose, "run", "--rm", "minio-init"]);
    await run(["bun", "test", "test/e2e"]);
  } catch (error) {
    try {
      await run([...compose, "logs", "tempo"]);
    } catch (logError) {
      console.error("Failed to collect Tempo logs", logError);
    }
    throw error;
  } finally {
    await run([...compose, "down", "-v"]);
  }
}

if (import.meta.main) void main();
