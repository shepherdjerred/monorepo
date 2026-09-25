import { e2eEnvironment, waitForTempo } from "./run-core.ts";

/** Woodpecker services: separate pods, reached by their service names. */
const HOSTS = { tempo: "tempo", minio: "minio" } as const;

async function main(): Promise<void> {
  await waitForTempo(async () => {
    const response = await fetch(`http://${HOSTS.tempo}:3200/ready`).catch(
      () => null,
    );
    return response?.ok === true;
  });
  const process = Bun.spawn(
    [
      "bun",
      "--no-install",
      "--bun",
      "vitest",
      "--config",
      "../../vitest.config.ts",
      "run",
      "test/e2e",
    ],
    {
      env: { ...Bun.env, ...e2eEnvironment(HOSTS) },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await process.exited;
  if (exitCode !== 0)
    throw new Error(`E2E tests exited ${exitCode.toString()}`);
}

if (import.meta.main) void main();
