import { statfs } from "node:fs/promises";
import {
  type CommandRunner,
  type DiskCapacitySummary,
  type DockerDiskSummary,
  evaluateDiskCapacity,
  parseDockerSystemDfOutput,
  type TendSurface,
} from "./types.ts";

export type StatDisk = (
  targetPath: string,
) => Promise<{ availableBytes: number; totalBytes: number } | null>;

export async function collectHostDiskCapacity(
  homeDir: string,
  statDisk: StatDisk | undefined,
): Promise<DiskCapacitySummary | null> {
  try {
    const raw =
      statDisk === undefined
        ? await statfs(homeDir).then((s) => ({
            availableBytes: s.bavail * s.bsize,
            totalBytes: s.blocks * s.bsize,
          }))
        : await statDisk(homeDir);
    return raw === null
      ? null
      : evaluateDiskCapacity(homeDir, raw.availableBytes, raw.totalBytes);
  } catch {
    return null;
  }
}

export async function collectDockerDiskSummary(
  mode: "status" | "run",
  selectedSurfaces: readonly TendSurface[],
  runner: CommandRunner,
): Promise<DockerDiskSummary | null> {
  if (mode !== "status" || !selectedSurfaces.includes("docker")) {
    return null;
  }
  const res = await runner(["docker", "system", "df", "--format", "json"], {
    timeoutMs: 3000,
  });
  if (res.exitCode !== 0) {
    return {
      available: false,
      rows: [],
      skippedReason:
        res.timedOut === true
          ? "docker system df timed out"
          : "docker daemon not running",
    };
  }
  return { available: true, rows: parseDockerSystemDfOutput(res.stdout) };
}
