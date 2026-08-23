import { describe, expect, test } from "vitest";
import {
  maintenanceCommandEnvironment,
  spawnMaintenanceCommand,
  spawnMaintenanceCommandCapturingStdout,
  type MaintenanceCommand,
  type MaintenanceCommandHooks,
} from "./maintenance.ts";

function command(
  args: readonly string[],
  secretValues: readonly string[] = [],
): MaintenanceCommand {
  return {
    kind: "main-vuln-scan",
    command: args,
    cwd: "/tmp",
    env: maintenanceCommandEnvironment({}),
    secretValues,
  };
}

function hooks(): MaintenanceCommandHooks {
  return {
    heartbeat: () => {
      // Recorded via Temporal in production; a no-op suffices here.
    },
    onCancellation: () => {
      // No cancellation in these subprocess tests.
    },
  };
}

describe("spawnMaintenanceCommandCapturingStdout", () => {
  test("returns complete stdout instead of only a tail", async () => {
    const lines = Array.from(
      { length: 50 },
      (_, index) => `line-${String(index)}`,
    );
    const result = await spawnMaintenanceCommandCapturingStdout(
      command(["sh", "-c", String.raw`printf '%s\n' ${lines.join(" ")}`]),
      hooks(),
    );
    expect(result.exitCode).toBe(0);
    // 50 lines exceeds the 20-line log tail — capture keeps every one.
    expect(result.stdout.split("\n")).toEqual(lines);
  });

  test("redacts secret values from captured output", async () => {
    const result = await spawnMaintenanceCommandCapturingStdout(
      command(["sh", "-c", "echo token=hunter2"], ["hunter2"]),
      hooks(),
    );
    expect(result.stdout).toBe("token=<redacted>");
  });

  test("throws on an unaccepted exit code with the stderr tail", async () => {
    await expect(
      spawnMaintenanceCommandCapturingStdout(
        command(["sh", "-c", "echo boom >&2; exit 3"]),
        hooks(),
      ),
    ).rejects.toThrow(/exited 3.*boom/s);
  });

  test("returns instead of throwing for a declared findings exit code", async () => {
    const result = await spawnMaintenanceCommandCapturingStdout(
      command(["sh", "-c", "echo findings; exit 2"]),
      hooks(),
      { acceptedExitCodes: [0, 2] },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("findings");
  });
});

describe("spawnMaintenanceCommand", () => {
  test("still returns the zero exit code for a successful command", async () => {
    await expect(
      spawnMaintenanceCommand(command(["true"]), hooks()),
    ).resolves.toBe(0);
  });

  test("still throws on a non-zero exit", async () => {
    await expect(
      spawnMaintenanceCommand(command(["sh", "-c", "exit 1"]), hooks()),
    ).rejects.toThrow(/exited 1/);
  });
});
