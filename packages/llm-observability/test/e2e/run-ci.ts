import { waitForTempo } from "./run-core.ts";

async function main(): Promise<void> {
  await waitForTempo(async () => {
    const response = await fetch("http://127.0.0.1:3200/ready").catch(
      () => null,
    );
    return response?.ok === true;
  });
  const process = Bun.spawn(["bun", "test", "test/e2e"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0)
    throw new Error(`E2E tests exited ${exitCode.toString()}`);
}

if (import.meta.main) void main();
