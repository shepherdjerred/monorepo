import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { open, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ManifestSchema } from "./manifest.ts";
import { createPmsWire, readPmsBootstrap, until } from "./http.ts";
import { assertLibraryWire } from "./assertions.ts";
import { assertEditionEdits } from "./edition-edits.ts";

async function stop(child: ChildProcess) {
  // Spawn failure has no process group to clean. A successful spawn owns exactly this group.
  if (child.pid === undefined) return;
  const pid = child.pid;
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!z.object({ code: z.literal("ESRCH") }).safeParse(error).success)
        throw error;
    }
  };
  const exited =
    child.exitCode === null && child.signalCode === null
      ? once(child, "exit")
      : Promise.resolve();
  kill("SIGTERM");
  const timer = setTimeout(() => {
    if (
      child.exitCode === null &&
      child.signalCode === null &&
      child.pid !== undefined
    )
      kill("SIGKILL");
  }, 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
    kill("SIGKILL");
  }
}

const directory = process.argv[2];
assert.ok(
  directory !== undefined && directory.length > 0,
  "Usage: compiled-harness <owned scratch directory>",
);
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64", "No emulated/arm64 fallback");
const root = path.resolve(directory);
assert.equal(root, path.resolve("packages/media/.cache/pms-wire"));
const manifest = ManifestSchema.parse(
  JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")),
);
assert.equal(manifest.root, root);
for (const file of manifest.files) {
  assert.ok(file.path.startsWith(`${path.join(root, "media")}/`));
  const bytes = await readFile(file.path);
  assert.equal(bytes.byteLength, file.size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
}
const config = path.join(root, "config");
const transcode = path.join(root, "transcode");
await mkdir(config);
await mkdir(transcode);
const log = await open(path.join(config, "pms-startup.log"), "wx");
const deadline = AbortSignal.timeout(180_000);
const wire = createPmsWire(root, deadline);
// Same binary/environment contract as the official image's services.d/plex/run.
// Only the child gets these paths. No existing Preferences.xml or tokens are used.
const child = spawn("/usr/lib/plexmediaserver/Plex Media Server", [], {
  detached: true,
  stdio: ["ignore", log.fd, log.fd],
  env: {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C.UTF-8",
    PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR: config,
    PLEX_MEDIA_SERVER_HOME: "/usr/lib/plexmediaserver",
    PLEX_MEDIA_SERVER_MAX_PLUGIN_PROCS: "6",
    PLEX_MEDIA_SERVER_INFO_VENDOR: "Docker",
    PLEX_MEDIA_SERVER_INFO_DEVICE: "Disposable CI wire fixture",
    PLEX_MEDIA_SERVER_INFO_MODEL: "x86_64",
    TMPDIR: transcode,
  },
});
let spawnError: Error | undefined;
child.on("error", (error) => {
  spawnError = error;
});
const report: Record<string, unknown> = {
  image: manifest.image,
  expectedVersion: manifest.version,
  provenance:
    "Generated colour bars/audio; synthetic naming only; not real film content or physical identity proof",
  status: "failed",
  calls: wire.calls,
};
const failures: unknown[] = [];
const describeFailure = (error: unknown) =>
  error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError" };
try {
  await until(
    "PMS local bootstrap",
    async () => {
      if (spawnError !== undefined) throw spawnError;
      assert.ok(
        child.exitCode === null && child.signalCode === null,
        "PMS exited during local bootstrap",
      );
      return await readPmsBootstrap(deadline);
    },
    deadline,
  );
  const identity = z
    .object({
      version: z.string(),
      machineIdentifier: z.string().min(1),
      claimed: z.boolean().optional(),
    })
    .parse(await wire.request("/identity"));
  assert.equal(identity.version, manifest.version);
  assert.ok(
    identity.claimed !== true,
    "Disposable server unexpectedly claimed",
  );
  report["identity"] = identity;
  await until("PMS library API readiness", wire.libraryReady, deadline);
  report["libraries"] = await assertLibraryWire(wire, manifest, deadline);
  report["editionEdits"] = await assertEditionEdits(wire, deadline);
  report["status"] = "passed";
} catch (error) {
  failures.push(error);
  report["error"] = describeFailure(error);
} finally {
  const cleanupFailures: unknown[] = [];
  let stopped = false;
  try {
    await stop(child);
    stopped = true;
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await log.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  const childReaped =
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null;
  report["childReaped"] = childReaped;
  report["processExit"] = { code: child.exitCode, signal: child.signalCode };
  // Do not delete support/config while either the child or its owned process group may remain.
  if (stopped && childReaped) {
    for (const target of [config, transcode, path.join(root, "media")]) {
      try {
        await rm(target, { recursive: true });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  } else report["scratchCleanup"] = "retained_unconfirmed_process_teardown";
  report["cleanupErrors"] = cleanupFailures.map((error) =>
    describeFailure(error),
  );
  if (cleanupFailures.length > 0) report["status"] = "failed";
  try {
    await writeFile(
      path.join(root, "artifacts", "report.json"),
      JSON.stringify(report, null, 2),
    );
  } catch (error) {
    cleanupFailures.push(error);
    report["status"] = "failed";
    report["cleanupErrors"] = cleanupFailures.map((failure) =>
      describeFailure(failure),
    );
  }
  failures.push(...cleanupFailures);
  // Stdout evidence is attempted independently of stop, log-close, cleanup and report-file failures.
  process.stdout.write(`${JSON.stringify(report)}\n`);
  // CI stdout is the existing durable evidence surface; no uploader or credential grant.
  // Only the endpoint-whitelisted, credential-screened, aggregate-bounded captures survive.
  for (const [key, capture] of wire.fixtures)
    process.stdout.write(
      `${JSON.stringify({ artifact: `pms-wire-${key}`, ...capture })}\n`,
    );
}
if (failures.length > 0)
  throw new AggregateError(failures, "Pinned PMS acceptance or cleanup failed");
