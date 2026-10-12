import { describe, expect, test } from "vitest";
import { reconcileStormCompanions } from "./storm-companions.ts";
import type { Command, CommandResult } from "./mining-reset-kubectl.ts";

const deniedCommand: Command = async () => ({
  stdout: "",
  stderr: "denied",
  exitCode: 1,
});

function fixture(
  pod: string,
  acknowledgement = "Companion reconciliation requested",
) {
  const calls: string[][] = [];
  const command: Command = async (args): Promise<CommandResult> => {
    calls.push([...args]);
    return {
      stdout: args[0] === "get" ? pod : acknowledgement,
      stderr: "",
      exitCode: 0,
    };
  };
  return { command, calls };
}

describe("companion core-hour reconciliation", () => {
  test("never wakes an absent or unready Minecraft server", async () => {
    for (const pod of [
      "",
      JSON.stringify({ status: { phase: "Pending" } }),
      JSON.stringify({
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "sidecar", ready: true },
            { name: "minecraft", ready: false },
          ],
        },
      }),
    ]) {
      const { command, calls } = fixture(pod);
      expect(await reconcileStormCompanions(command)).toBe("sleeping");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe("get");
    }
  });

  test("targets the ready game container and requires acknowledgement", async () => {
    const pod = JSON.stringify({
      status: {
        phase: "Running",
        containerStatuses: [{ name: "minecraft", ready: true }],
      },
    });
    const { command, calls } = fixture(pod);
    expect(await reconcileStormCompanions(command)).toBe("reconciled");
    expect(calls[1]).toEqual([
      "exec",
      "-n",
      "minecraft-tsmc",
      "minecraft-tsmc-0",
      "-c",
      "minecraft",
      "--",
      "rcon-cli",
      "companion reconcile",
    ]);
    const rejected = fixture(pod, "Unknown command");
    await expect(reconcileStormCompanions(rejected.command)).rejects.toThrow(
      "acknowledge",
    );
  });

  test("fails an API error rather than treating it as a sleeping server", async () => {
    await expect(reconcileStormCompanions(deniedCommand)).rejects.toThrow(
      "cannot inspect",
    );
  });
});
