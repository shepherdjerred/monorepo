import assert from "node:assert/strict";
import { chmod, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { boundedCommandResult } from "./bounded-command.ts";
import {
  lifetime,
  retireRetainedOwner,
  type LaunchJournal,
  type RunBinding,
} from "./retained-owner.ts";

/** Uses the same canonical signal-boundary helper as the older per-run live harness. */
export async function retireMacRun(
  binding: RunBinding,
  journal: LaunchJournal | null,
  directory: string,
): Promise<Awaited<ReturnType<typeof retireRetainedOwner>>> {
  const deadline = Date.now() + 25_000;
  const command = (argv: string[], input?: string, acceptedExitCodes = [0]) => {
    assert.ok(
      Date.now() < deadline,
      "Cleanup deadline exhausted before another native operation",
    );
    return boundedCommandResult(argv, {
      cwd: directory,
      logs: path.join(directory, "cleanup-commands"),
      capture: true,
      timeoutMS: Math.max(1, deadline - Date.now()),
      ...(input === undefined ? {} : { input }),
      acceptedExitCodes,
    });
  };
  const helper = path.join(directory, "process-owner");
  const source = path.join(import.meta.dir, "mac-process-owner.swift");
  const sourceBytes = await readFile(source);
  await command(["/usr/bin/xcrun", "swiftc", source, "-o", helper]);
  await chmod(helper, 0o700);
  const helperBytes = await readFile(helper);
  const invoke = async (
    operation: "inspect" | "terminate",
    pid: number,
    expected: unknown,
  ) => {
    assert.equal(await realpath(helper), helper);
    assert.ok(
      (await readFile(helper)).equals(helperBytes) &&
        (await readFile(source)).equals(sourceBytes),
      "Native owner helper changed",
    );
    // Rejected inspect/terminate commands fail closed; no second discovery is adopted.
    const response = await command(
      [helper],
      JSON.stringify({
        schemaVersion: 1,
        operation,
        pid,
        executable: binding.executable,
        expected,
      }),
      [0, 3],
    );
    const raw: unknown = JSON.parse(response.stdout);
    assert.equal(
      response.stderr,
      "",
      "Native owner diagnostic rejects the response",
    );
    assert.ok(raw !== null && typeof raw === "object");
    assert.deepEqual(
      Object.keys(raw).sort(),
      [
        "schemaVersion",
        "operation",
        "pid",
        "outcome",
        "identity",
        "reason",
        "signalSubmitted",
      ].sort(),
    );
    assert.equal(Reflect.get(raw, "schemaVersion"), 1);
    assert.equal(Reflect.get(raw, "operation"), operation);
    assert.equal(Reflect.get(raw, "pid"), pid);
    if (
      operation === "inspect" &&
      Reflect.get(raw, "outcome") === "rejected" &&
      Reflect.get(raw, "reason") === "missing-process"
    ) {
      assert.equal(response.exitCode, 3);
      assert.equal(Reflect.get(raw, "identity"), null);
      assert.equal(Reflect.get(raw, "signalSubmitted"), false);
      return null;
    }
    assert.equal(response.exitCode, 0);
    assert.equal(Reflect.get(raw, "reason"), null);
    assert.equal(
      Reflect.get(raw, "outcome"),
      operation === "inspect" ? "inspected" : "signal-submitted",
    );
    assert.equal(
      Reflect.get(raw, "signalSubmitted"),
      operation === "terminate",
    );
    const result = lifetime(Reflect.get(raw, "identity"));
    if (expected !== null) assert.deepEqual(result, expected);
    return result;
  };
  return retireRetainedOwner(
    journal,
    binding,
    {
      inspect: async () => {
        const listing = await command(
          ["/usr/sbin/lsof", "-t", "-a", "-d", "txt", "--", binding.executable],
          undefined,
          [0, 1],
        );
        assert.equal(
          listing.stderr,
          "",
          "Process discovery diagnostic rejects ownership",
        );
        if (listing.exitCode === 1 && listing.stdout === "") return [];
        assert.equal(
          listing.exitCode,
          0,
          "Unexpected process-discovery status",
        );
        assert.match(
          listing.stdout,
          /^[1-9]\d*$/u,
          "Process discovery must return exactly one PID",
        );
        const pid = Number(listing.stdout);
        assert.ok(Number.isSafeInteger(pid) && pid <= 2_147_483_647);
        return [pid];
      },
      identity: (pid) => invoke("inspect", pid, null),
      terminate: async (pid, expected) => {
        await invoke("terminate", pid, expected);
      },
      now: Date.now,
      pause: Bun.sleep,
    },
    Math.max(1, deadline - Date.now()),
  );
}
