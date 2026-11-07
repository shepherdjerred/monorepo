import path from "node:path";
import { mkdir, lstat } from "node:fs/promises";
import { z } from "zod";
import { CACHE_DIR, MC_DIR, SOCKET_PATH } from "#protocol/paths.ts";
import { ShutdownResponseSchema, StatusResponseSchema } from "#protocol/ipc.ts";
import { CaptureTransport } from "#src/capture/transport.ts";
import { captureSuite } from "./orchestrate.ts";
import { awsStore } from "./aws-store.ts";
import { restoreDependencies } from "./runtime.ts";

const absolute = z.string().refine((value) => path.isAbsolute(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const RequestSchema = z.strictObject({
  repoRoot: absolute,
  suiteFile: absolute,
  directory: absolute,
  cache: absolute,
  id: z.uuid(),
  fixture: hash,
  runtime: z.strictObject({ sourceDirectory: absolute, hash }),
  scenario: z.string().optional(),
  shot: z.string().optional(),
  rolloutSnapshot: hash.nullable().optional(),
});

async function socketExists() {
  try {
    const stat = await lstat(SOCKET_PATH);
    return stat.isSocket();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** An owned daemon from the recorded checkout, isolated from every interactive session. */
export async function captureWorker(file: string): Promise<void> {
  const request = RequestSchema.parse(await Bun.file(file).json());
  if (
    MC_DIR !== path.join(request.directory, "harness") ||
    Buffer.byteLength(SOCKET_PATH) > 103
  )
    throw new Error("Capture worker needs its own short daemon directory");
  await mkdir(MC_DIR, { recursive: false, mode: 0o700 });
  const store = awsStore("the-storm-capture-fixtures");
  await restoreDependencies(store, {
    cache: request.cache,
    runtimeHash: request.runtime.hash,
    destination: CACHE_DIR,
  });
  const logPath = path.join(MC_DIR, "startup.log");
  const log = Bun.file(logPath);
  const daemon = Bun.spawn(
    [
      "bun",
      path.join(
        request.runtime.sourceDirectory,
        "packages/mc-harness/src/daemon/main.ts",
      ),
    ],
    {
      cwd: request.runtime.sourceDirectory,
      stdin: "ignore",
      stdout: log,
      stderr: log,
      env: {
        ...Bun.env,
        OP_SERVICE_ACCOUNT_TOKEN: undefined,
        MC_BRIDGE_TOKEN: undefined,
      },
    },
  );
  const control = new CaptureTransport("suite", "Own documentation daemon");
  let ready = false;
  try {
    const deadline = performance.now() + 30_000;
    while (!ready) {
      if (daemon.exitCode !== null)
        throw new Error(`Capture daemon exited; inspect ${logPath}`);
      if (performance.now() > deadline)
        throw new Error(`Capture daemon startup timed out; inspect ${logPath}`);
      if (await socketExists()) {
        const status = await control.request(
          StatusResponseSchema,
          "GET",
          "/status",
        );
        if (
          status.pid !== daemon.pid ||
          status.repoRoot !== request.runtime.sourceDirectory
        )
          throw new Error("Capture daemon identity differs");
        ready = true;
      } else await Bun.sleep(100);
    }
    await captureSuite({ ...request, store });
  } finally {
    try {
      if (ready)
        await control.request(ShutdownResponseSchema, "POST", "/shutdown", {});
    } finally {
      if (daemon.exitCode === null) daemon.kill("SIGTERM");
      const exited = await Promise.race([
        daemon.exited.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ]);
      if (!exited) {
        daemon.kill("SIGKILL");
        await daemon.exited;
      }
    }
  }
}

if (import.meta.main) await captureWorker(z.string().min(1).parse(Bun.argv[2]));
