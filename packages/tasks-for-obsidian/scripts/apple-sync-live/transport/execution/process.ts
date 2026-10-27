import assert from "node:assert/strict";
import { chmod, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import { boundedCommandResult } from "tasknotes-macos/scripts/apple-acceptance/bounded-command.ts";
import { inspectOwnedMacProcesses } from "../../mac-process-inspection.ts";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";

/** Same signal-boundary schema and native helper as the live harness; no process-name kill. */
export async function retireGuestProcess(
  executable: string,
  exportRoot: string,
  evidence: string,
) {
  const source = path.join(exportRoot, "live-helpers/mac-process-owner.swift"),
    schema = z
      .record(z.string(), z.unknown())
      .parse(
        JSON.parse(
          await readFile(
            path.join(exportRoot, "live-helpers/mac-process-owner.schema.json"),
            "utf8",
          ),
        ),
      );
  const validator = new Ajv2020({ strict: false }).compile({
    ...schema,
    $ref: "#/$defs/response",
  });
  const deadline = Date.now() + 25_000,
    remaining = () => {
      assert.ok(Date.now() < deadline);
      return Math.max(1, deadline - Date.now());
    };
  const run = (argv: string[], input?: string) =>
    boundedCommandResult(argv, {
      cwd: evidence,
      logs: path.join(evidence, "retirement-commands"),
      capture: true,
      timeoutMS: remaining(),
      acceptedExitCodes: [0, 3],
      ...(input === undefined ? {} : { input }),
    });
  const owners = await inspectOwnedMacProcesses(
    executable,
    Math.min(5000, remaining()),
  );
  assert.ok(owners.length <= 1);
  const owner = owners[0];
  if (owner === undefined)
    return { signalSubmitted: false, observedExit: true as const };
  const pid = Number(owner);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const helper = path.join(evidence, `process-owner-${crypto.randomUUID()}`),
    sourceSHA = await macFileSHA(source);
  const built = await run(["/usr/bin/xcrun", "swiftc", source, "-o", helper]);
  assert.equal(built.exitCode, 0);
  await chmod(helper, 0o700);
  const binarySHA = await macFileSHA(helper);
  const invoke = async (
    operation: "inspect" | "terminate",
    expected: unknown,
  ) => {
    assert.equal(await realpath(helper), helper);
    assert.equal(await macFileSHA(helper), binarySHA);
    assert.equal(await macFileSHA(source), sourceSHA);
    const response = await run(
      [helper],
      JSON.stringify({
        schemaVersion: 1,
        operation,
        pid,
        executable,
        expected,
      }),
    );
    assert.equal(response.stderr, "");
    assert.equal(response.exitCode, 0);
    const raw: unknown = JSON.parse(response.stdout);
    assert.ok(validator(raw));
    assert.ok(raw !== null && typeof raw === "object");
    assert.equal(Reflect.get(raw, "operation"), operation);
    assert.equal(Reflect.get(raw, "pid"), pid);
    assert.equal(Reflect.get(raw, "reason"), null);
    assert.equal(
      Reflect.get(raw, "outcome"),
      operation === "inspect" ? "inspected" : "signal-submitted",
    );
    assert.equal(
      Reflect.get(raw, "signalSubmitted"),
      operation === "terminate",
    );
    const identity: unknown = Reflect.get(raw, "identity");
    assert.ok(identity !== null);
    if (expected !== null) assert.deepEqual(identity, expected);
    return identity;
  };
  const identity = await invoke("inspect", null);
  await invoke("terminate", identity);
  for (;;) {
    const present = await inspectOwnedMacProcesses(
      executable,
      Math.min(5000, remaining()),
    );
    if (present.length === 0)
      return { signalSubmitted: true, observedExit: true as const };
    assert.deepEqual(
      present,
      owners,
      "A replacement owner must be left running",
    );
    await invoke("inspect", identity);
    await Bun.sleep(Math.min(100, remaining()));
  }
}
