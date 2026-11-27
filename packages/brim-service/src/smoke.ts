import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const reservation = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(null, { status: 503 }),
});
const port = String(reservation.port);
await reservation.stop();
const directory = await mkdtemp(path.join(os.tmpdir(), "brim-smoke-"));
const origin = `http://127.0.0.1:${port}`;
const child = Bun.spawn(
  [process.execPath, path.join(import.meta.dir, "index.js")],
  {
    env: {
      HOST: "127.0.0.1",
      PORT: port,
      BRIM_DATA_DIR: directory,
      BRIM_ARCHIVE_DIR: path.join(directory, "archive"),
      BRIM_HUB_TOKEN: "smoke-hub",
      BRIM_DEVICE_TOKEN: "smoke-device",
      BRIM_MACBOOK_PUBLISH_TOKEN: "smoke-publish",
      BRIM_SCHEDULER_TOKEN: "smoke-scheduler",
      BRIM_SYNC_AGE_IDENTITY: "AGE-SECRET-KEY-1-SMOKE",
      AWS_ENDPOINT_URL_S3: origin,
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "smoke-access",
      AWS_SECRET_ACCESS_KEY: "smoke-secret",
    },
    stderr: "inherit",
  },
);

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Brim exited with code ${String(child.exitCode)}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      await response.body?.cancel();
      if (response.ok) return;
    } catch (error: unknown) {
      if (attempt === 29) throw error;
    }
    await Bun.sleep(1000);
  }
  throw new Error("Brim did not become healthy");
}

try {
  await waitForHealth();
  const route = `${origin}/v1/overview`;
  const unauthenticated = await fetch(route);
  await unauthenticated.body?.cancel();
  const authenticated = await fetch(route, {
    headers: { authorization: "Bearer smoke-hub" },
  });
  await authenticated.body?.cancel();
  if (unauthenticated.status !== 401 || authenticated.status !== 200) {
    throw new Error("Brim's overview authorization smoke test failed");
  }
  await Bun.write(
    Bun.stdout,
    "Brim smoke passed: health 200, anonymous overview 401, Hub overview 200\n",
  );
} finally {
  child.kill();
  await child.exited;
  await rm(directory, { recursive: true, force: true });
}
