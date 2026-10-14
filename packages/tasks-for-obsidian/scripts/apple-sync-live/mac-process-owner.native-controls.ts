import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import {
  compileProcessOwner,
  invokeProcessOwner,
  validProcessOwnerPacket,
} from "./mac-process-owner";
import { captureProcessTool, inspectionBudget } from "./mac-process-inspection";

// Explicit local native controls; this never discovers or signals a live application.
assert.equal(
  process.platform,
  "darwin",
  "Native process-owner controls require macOS",
);
const deadline = Date.now() + 30_000;
const remainingMS = () => deadline - Date.now();
const helper = await compileProcessOwner(remainingMS);
const executable = await realpath(process.execPath);
const child = Bun.spawn([executable, "-e", "setInterval(()=>{},1000)"], {
  env: {},
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
});
const request = {
  schemaVersion: 1 as const,
  operation: "inspect" as const,
  pid: child.pid,
  executable,
  expected: null,
};
let negativeControls = 0;
try {
  const inspected = await invokeProcessOwner(helper, request, remainingMS);
  assert.equal(inspected.outcome, "inspected");
  assert.ok(inspected.identity);
  const owner = inspected.identity;
  for (const [reason, changes, expected] of [
    ["uid", {}, { ...owner, uid: owner.uid + 1 }],
    ["uid", {}, { ...owner, ruid: owner.ruid + 1 }],
    ["path", { executable: executable + ".other" }, owner],
    [
      "lifetime",
      {},
      {
        ...owner,
        startMicroseconds: (owner.startMicroseconds + 1) % 1_000_000,
      },
    ],
  ] as const) {
    const rejected = await invokeProcessOwner(
      helper,
      { ...request, ...changes, operation: "terminate", expected },
      remainingMS,
    );
    assert.equal(rejected.outcome, "rejected");
    assert.equal(rejected.reason, reason);
    assert.equal(rejected.signalSubmitted, false);
    assert.equal(child.exitCode, null);
    negativeControls++;
  }
  for (const invalidRequest of [
    { ...request, extra: true },
    { ...request, schemaVersion: true },
    { ...request, pid: false },
    { ...request, pid: 0 },
    { ...request, operation: "SIGKILL" },
    { ...request, executable: "/synthetic/\npath" },
    { ...request, expected: owner },
    { ...request, operation: "terminate" },
    { ...request, operation: "terminate", expected: { ...owner, uid: false } },
    {
      ...request,
      operation: "terminate",
      expected: { ...owner, startMicroseconds: 1_000_000 },
    },
  ]) {
    assert.equal(validProcessOwnerPacket("request", invalidRequest), false);
    const invalid = await captureProcessTool(
      [helper.filename],
      inspectionBudget(remainingMS()),
      JSON.stringify(invalidRequest),
    );
    assert.equal(invalid.exitCode, 3);
    assert.equal(invalid.stderr, "");
    const rejected: unknown = JSON.parse(invalid.stdout);
    assert.equal(validProcessOwnerPacket("response", rejected), true);
    z.object({
      reason: z.literal("input"),
      signalSubmitted: z.literal(false),
    }).parse(rejected);
    assert.equal(child.exitCode, null);
    negativeControls++;
  }
  const submitted = await invokeProcessOwner(
    helper,
    { ...request, operation: "terminate", expected: owner },
    remainingMS,
  );
  assert.equal(submitted.outcome, "signal-submitted");
  assert.equal(submitted.signalSubmitted, true);
  const exited = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(2000).then(() => false),
  ]);
  assert.equal(exited, true, "Submitted TERM must be observed separately");
  console.log(
    JSON.stringify({
      nativeOwnerGuardControlsPassed: negativeControls,
      rejectedSignalCount: 0,
      harmlessChildTERMSubmitted: true,
      harmlessChildExitObserved: true,
    }),
  );
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([child.exited, Bun.sleep(2000)]);
  }
}
