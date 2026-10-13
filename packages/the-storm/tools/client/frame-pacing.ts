import path from "node:path";
import os from "node:os";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { packageRoot } from "#e2e/harness/paths.ts";
import { request, waitFor, type Session } from "./protocol.ts";
import {
  FramePacingStatus,
  validateFramePacing,
  type FramePacingReceipt,
} from "./frame-pacing-wire.ts";

const files = [
  "client/src/main/java/com/shepherdjerred/thestorm/client/FramePacing.java",
  "client/src/main/java/com/shepherdjerred/thestorm/client/FramePacingClock.java",
  "client/src/main/java/com/shepherdjerred/thestorm/client/RenderCapture.java",
  "client/src/main/java/com/shepherdjerred/thestorm/client/mixin/FrameRenderMixin.java",
  "client/src/main/java/com/shepherdjerred/thestorm/client/ClientActions.java",
  "client/src/main/resources/storm-frame-pacing.json",
  "client/build.gradle.kts",
  "client/settings.gradle.kts",
  "plugin/gradle/libs.versions.toml",
  "tools/client/frame-pacing.ts",
  "tools/client/frame-pacing-wire.ts",
  "tools/client/process.ts",
];
const sha = (bytes: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function sourceHashes() {
  return Promise.all(
    files.map(async (file) => ({
      file,
      sha256: sha(
        new Uint8Array(
          await Bun.file(path.join(packageRoot, file)).arrayBuffer(),
        ),
      ),
    })),
  );
}

/** Collect an original native-client timing window; it establishes measurement, not an invented pass bar. */
export async function collectFramePacing(
  session: Session,
  options: {
    name: string;
    context: {
      phase: "baseline" | "active";
      total: number;
      map: string;
      match: string | null;
      serverInputs: Record<string, unknown>;
    };
    durationMs?: number;
    targetFrames?: number;
  },
) {
  const producer = await sourceHashes();
  const beganAt = Date.now();
  await request(session, "frame-pacing-start", {
    name: options.name,
    durationMs: options.durationMs ?? 60_000,
    targetFrames: options.targetFrames ?? 36_000,
  });
  const completed = await waitFor(
    "original native frame pacing window",
    async () => {
      const value = FramePacingStatus.parse(
        await request(session, "frame-pacing-status"),
      );
      if (value.state === "FAILED")
        throw new Error(
          `Frame pacing failed: ${value.error}; original receipt: ${value.receipt}`,
        );
      return value;
    },
    (value) => value.state === "COMPLETE",
    (options.durationMs ?? 60_000) + 15_000,
  );
  const expectedFile = path.join(
    session.artifacts,
    `${options.name}-frame-pacing.json`,
  );
  if (completed.name !== options.name || completed.receipt !== expectedFile)
    throw new Error(
      "Native frame pacing returned another measurement's receipt",
    );
  const bytes = await Bun.file(expectedFile).bytes();
  const receipt = validateFramePacing(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (!isDeepStrictEqual(producer, await sourceHashes()))
    throw new Error("Frame pacing producer changed during native measurement");
  let hardwareModel: string | null = null;
  if (process.platform === "darwin") {
    const command = Bun.spawn(["sysctl", "-n", "hw.model"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, error, status] = await Promise.all([
      new Response(command.stdout).text(),
      new Response(command.stderr).text(),
      command.exited,
    ]);
    if (status !== 0)
      throw new Error(`Cannot identify measurement hardware: ${error}`);
    hardwareModel = output.trim();
  }
  const result = {
    schema: 1,
    kind: "rwf-native-frame-pacing-evidence",
    context: options.context,
    beganAt,
    completedAt: Date.now(),
    producer,
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      hardwareModel,
      cpuModels: [...new Set(os.cpus().map((cpu) => cpu.model))],
      logicalCpus: os.cpus().length,
      bunVersion: Bun.version,
    },
    original: { file: expectedFile, sha256: sha(bytes) },
    receipt,
    focusedFrames: receipt.observations.filter((frame) => frame.focused).length,
    menuFrames: receipt.observations.filter((frame) => frame.screenOpen).length,
    performanceAccepted: false,
  };
  const output = path.join(
    session.artifacts,
    `${options.name}-frame-pacing-evidence.json`,
  );
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return { file: output, ...result };
}

/** Compare baseline/active observations under the same client runtime and configured render settings. */
export function compareFramePacing(
  baseline: FramePacingReceipt,
  active: FramePacingReceipt,
) {
  const left = validateFramePacing(baseline);
  const right = validateFramePacing(active);
  if (
    !isDeepStrictEqual(left.settings, right.settings) ||
    !isDeepStrictEqual(left.runtime, right.runtime)
  )
    throw new Error(
      "Baseline and active frame pacing used different render settings or runtime",
    );
  const camera = left.observations[0]?.camera;
  if (camera === undefined) throw new Error("Baseline camera is missing");
  const sameView = [...left.observations, ...right.observations].every(
    ({ camera: actual }) =>
      Math.hypot(
        actual.x - camera.x,
        actual.y - camera.y,
        actual.z - camera.z,
      ) <= 0.000001 &&
      Math.abs(
        (Math.atan2(
          Math.sin(((actual.yaw - camera.yaw) * Math.PI) / 180),
          Math.cos(((actual.yaw - camera.yaw) * Math.PI) / 180),
        ) *
          180) /
          Math.PI,
      ) <= 0.0001 &&
      Math.abs(actual.pitch - camera.pitch) <= 0.0001,
  );
  if (!sameView || left.world !== right.world)
    throw new Error(
      "Baseline and active frame pacing did not retain the same world and camera",
    );
  return {
    baseline: left.quantiles,
    active: right.quantiles,
    p95ChangeNanos: right.quantiles.p95Nanos - left.quantiles.p95Nanos,
    p99ChangeNanos: right.quantiles.p99Nanos - left.quantiles.p99Nanos,
    tailNanos: { baseline: left.tailNanos, active: right.tailNanos },
    performanceAccepted: false,
  };
}
