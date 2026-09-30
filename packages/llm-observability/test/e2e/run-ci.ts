import { e2eEnvironment, waitForTempo } from "./run-core.ts";
import { signedFetch } from "./signed-fetch.ts";

/** Woodpecker services: separate pods, reached by their service names. */
const HOSTS = { tempo: "tempo", minio: "minio" } as const;
const MINIO_ENDPOINT = `http://${HOSTS.minio}:9000`;

async function createArchiveBucket(): Promise<void> {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${MINIO_ENDPOINT}/minio/health/live`).catch(
      () => null,
    );
    if (response?.ok === true) {
      ready = true;
      break;
    }
    await Bun.sleep(1000);
  }
  if (!ready) throw new Error("MinIO did not become ready within 60s");

  const response = await signedFetch({
    url: `${MINIO_ENDPOINT}/llm-archive`,
    method: "PUT",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    region: "us-east-1",
  });
  if (!response.ok) {
    throw new Error(
      `MinIO archive bucket creation failed: ${response.status.toString()} ${await response.text()}`,
    );
  }
}

async function main(): Promise<void> {
  await waitForTempo(async () => {
    const response = await fetch(`http://${HOSTS.tempo}:3200/ready`).catch(
      () => null,
    );
    return response?.ok === true;
  });
  await createArchiveBucket();
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
