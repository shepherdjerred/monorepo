import { describe, expect, test, vi } from "vitest";
import {
  captureProcessTool,
  inspectOwnedMacProcesses,
  inspectionBudget,
  MacProcessInspectionError,
  type InspectionResult,
} from "./mac-process-inspection";
import { stopOwnedMacProcess } from "./mac-process-owner";

const executable =
  "/synthetic/FacetAcceptance.app/Contents/MacOS/FacetAcceptance";
const noAction = async () => {
  // Injected unit controls never perform a process or timer action.
};
const successful = (
  changes: Partial<InspectionResult> = {},
): InspectionResult => ({
  stdout: "12\n",
  stderr: "",
  exitCode: 0,
  signalCode: null,
  timedOut: false,
  outputLimit: false,
  ...changes,
});

describe("strict owned-process inspection", () => {
  test("only an explicit clean lsof absence permits zero owners", async () => {
    await expect(
      inspectOwnedMacProcesses(executable, 50, async () =>
        successful({ stdout: "", exitCode: 1 }),
      ),
    ).resolves.toEqual([]);
    for (const result of [
      successful({ stdout: "" }),
      successful({ stdout: "\n", exitCode: 1 }),
      successful({ stdout: "", exitCode: 1, stderr: "\n" }),
    ])
      await expect(
        inspectOwnedMacProcesses(executable, 50, async () => result),
      ).rejects.toBeInstanceOf(MacProcessInspectionError);
  });

  test("accepts exactly one canonical bounded PID, never ambiguous or malformed owners", async () => {
    await expect(
      inspectOwnedMacProcesses(executable, 50, async () => successful()),
    ).resolves.toEqual(["12"]);
    for (const stdout of [
      "0\n",
      "012\n",
      " 12\n",
      "12\n13\n",
      "12\n12\n",
      "12\n\n",
      "2147483648\n",
      "synthetic-sensitive-path\n",
    ])
      await expect(
        inspectOwnedMacProcesses(executable, 50, async () =>
          successful({ stdout }),
        ),
      ).rejects.toBeInstanceOf(MacProcessInspectionError);
  });

  test.each([
    ["deadline", { timedOut: true, signalCode: "SIGKILL", exitCode: 137 }],
    ["signal", { signalCode: "SIGTERM", exitCode: 143 }],
    ["diagnostic", { stderr: "synthetic-sensitive-path" }],
    ["exit-status", { exitCode: 2 }],
    ["owner-count", { stdout: "12\n13\n" }],
    ["pid-shape", { stdout: "not-a-pid" }],
    ["output-limit", { stdout: "x".repeat(4097) }],
  ] as const)(
    "retains the closed %s rejection without raw diagnostics",
    async (reason, changes) => {
      try {
        await inspectOwnedMacProcesses(executable, 25, async () =>
          successful(changes),
        );
        throw new Error("Expected inspection rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(MacProcessInspectionError);
        if (!(error instanceof MacProcessInspectionError)) throw error;
        expect(error.reason).toBe(reason);
        expect(error.budgetMS).toBe(25);
        expect(error.message).not.toContain("synthetic-sensitive-path");
      }
    },
  );

  test("propagates the actual remaining deadline and caps inspection work", async () => {
    const inspect = vi.fn(async (_executable: string, _budget: number) =>
      successful(),
    );
    await inspectOwnedMacProcesses(executable, 25, inspect);
    await inspectOwnedMacProcesses(executable, 120_000, inspect);
    expect(inspect.mock.calls).toEqual([
      [executable, 25],
      [executable, 10_000],
    ]);
    for (const invalid of [0, -1, NaN, Infinity, 1.5])
      expect(() => inspectionBudget(invalid)).toThrow(
        MacProcessInspectionError,
      );
  });

  test("reaps a stalled tool and its inherited-output descendant at the deadline", async () => {
    const code =
      'Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdout:"inherit",stderr:"inherit"});setInterval(()=>{},1000)';
    const began = Date.now();
    const result = await captureProcessTool(
      [process.execPath, "-e", code],
      200,
    );
    expect(result.timedOut).toBe(true);
    expect(result.signalCode).toBe("SIGKILL");
    expect(Date.now() - began).toBeLessThan(2000);
  });

  test("bounds inherited pipes even after the tool leader exits", async () => {
    const code =
      'Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdout:"inherit",stderr:"inherit"});process.exit(0)';
    const began = Date.now();
    const result = await captureProcessTool(
      [process.execPath, "-e", code],
      200,
    );
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - began).toBeLessThan(2000);
  });

  test("retains at most the bounded output and rejects excessive production", async () => {
    const result = await captureProcessTool(
      [
        process.execPath,
        "-e",
        'process.stdout.write("x".repeat(1024*1024));setInterval(()=>{},1000)',
      ],
      1000,
    );
    expect(result.outputLimit).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
    await expect(
      inspectOwnedMacProcesses(executable, 1000, async () => result),
    ).rejects.toMatchObject({ reason: "output-limit" });
  });
});

describe("owned-process retirement deadline", () => {
  test("observes absence without signaling and rejects ambiguity before retirement", async () => {
    const retire = vi.fn(noAction);
    const controls = {
      inspect: vi.fn(async (): Promise<string[]> => []),
      retire,
      now: () => 0,
      sleep: noAction,
    };
    await expect(
      stopOwnedMacProcess(executable, () => 120_000, controls),
    ).resolves.toEqual({ signalSubmitted: false, observedExit: true });
    controls.inspect.mockResolvedValue(["12", "13"]);
    await expect(
      stopOwnedMacProcess(executable, () => 120_000, controls),
    ).rejects.toMatchObject({ reason: "owner-count" });
    expect(retire).not.toHaveBeenCalled();
  });

  test("keeps signal submission distinct from observed exit", async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(["12"])
      .mockResolvedValueOnce([]);
    const retire = vi.fn(noAction);
    await expect(
      stopOwnedMacProcess(executable, () => 120_000, {
        inspect,
        retire,
        now: () => 0,
        sleep: noAction,
      }),
    ).resolves.toEqual({ signalSubmitted: true, observedExit: true });
    expect(retire).toHaveBeenCalledOnce();
    expect(retire.mock.calls[0]?.slice(0, 2)).toEqual(["12", executable]);
    expect(inspect.mock.calls).toEqual([
      [executable, 10_000],
      [executable, 10_000],
    ]);
  });

  test("does not adopt or signal a replacement process", async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(["12"])
      .mockResolvedValueOnce(["13"]);
    const retire = vi.fn(noAction);
    await expect(
      stopOwnedMacProcess(executable, () => 120_000, {
        inspect,
        retire,
        now: () => 0,
        sleep: noAction,
      }),
    ).rejects.toThrow("changed during retirement");
    expect(retire).toHaveBeenCalledOnce();
  });

  test("honors a smaller parent budget after TERM without any later inspection", async () => {
    let now = 0;
    const inspect = vi.fn(async () => ["12"]);
    const retire = vi.fn(async () => {
      now = 470;
    });
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    await expect(
      stopOwnedMacProcess(executable, () => 500 - now, {
        inspect,
        retire,
        now: () => now,
        sleep,
      }),
    ).rejects.toMatchObject({ reason: "deadline" });
    expect(inspect.mock.calls).toEqual([
      [executable, 500],
      [executable, 30],
    ]);
    expect(sleep).toHaveBeenCalledWith(30);
    expect(retire).toHaveBeenCalledOnce();
  });

  test("honors the 15-second shutdown deadline even with a longer parent budget", async () => {
    let now = 0,
      inspections = 0;
    const inspect = vi.fn(async () => {
      if (++inspections === 2) now = 14_999;
      return ["12"];
    });
    const retire = vi.fn(noAction);
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    await expect(
      stopOwnedMacProcess(executable, () => 120_000 - now, {
        inspect,
        retire,
        now: () => now,
        sleep,
      }),
    ).rejects.toMatchObject({ reason: "deadline" });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
    expect(retire).toHaveBeenCalledOnce();
  });

  test("rejects primary identity failures without another signal attempt or launch", async () => {
    const inspect = vi.fn(async () => ["12"]);
    const retire = vi.fn(async () => {
      throw new Error("uid");
    });
    await expect(
      stopOwnedMacProcess(executable, () => 120_000, {
        inspect,
        retire,
        now: () => 0,
        sleep: noAction,
      }),
    ).rejects.toThrow("uid");
    expect(inspect).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
  });
});
