import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { contract, digest, packageRoot } from "./model";
import {
  captureProcessTool,
  inspectOwnedMacProcesses,
  inspectionBudget,
  MacProcessInspectionError,
} from "./mac-process-inspection";

const source = path.join(import.meta.dir, "mac-process-owner.swift");
const schemaPath = path.join(import.meta.dir, "mac-process-owner.schema.json");
const schemaBytes = await readFile(schemaPath);
const schema = z
  .record(z.string(), z.unknown())
  .parse(JSON.parse(schemaBytes.toString()));
const requestValidator = contract.compile({
  ...schema,
  $ref: "#/$defs/request",
});
const responseValidator = contract.compile({
  ...schema,
  $ref: "#/$defs/response",
});
export function validProcessOwnerPacket(
  definition: "request" | "response",
  value: unknown,
) {
  return (definition === "request" ? requestValidator : responseValidator)(
    value,
  );
}
const IdentitySchema = z.strictObject({
  uid: z.number(),
  ruid: z.number(),
  startSeconds: z.number(),
  startMicroseconds: z.number(),
});
export type MacProcessIdentity = z.infer<typeof IdentitySchema>;
type Request = {
  schemaVersion: 1;
  operation: "inspect" | "terminate";
  pid: number;
  executable: string;
  expected: MacProcessIdentity | null;
};
const ResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.enum(["inspect", "terminate"]).nullable(),
  pid: z.number().nullable(),
  outcome: z.enum(["inspected", "signal-submitted", "rejected"]),
  identity: IdentitySchema.nullable(),
  reason: z
    .enum(["input", "missing-process", "uid", "path", "lifetime", "signal"])
    .nullable(),
  signalSubmitted: z.boolean(),
});
export type ProcessOwnerHelper = {
  filename: string;
  binarySHA256: string;
  sourceSHA256: string;
};

function requireCapturedSuccess(
  result: Awaited<ReturnType<typeof captureProcessTool>>,
) {
  if (result.timedOut)
    throw new MacProcessInspectionError(
      "deadline",
      result.exitCode,
      result.signalCode,
    );
  if (result.outputLimit)
    throw new MacProcessInspectionError(
      "output-limit",
      result.exitCode,
      result.signalCode,
    );
  if (result.signalCode !== null)
    throw new MacProcessInspectionError(
      "signal",
      result.exitCode,
      result.signalCode,
    );
  if (result.stderr !== "")
    throw new MacProcessInspectionError("diagnostic", result.exitCode);
  if (result.stdout.length > 4096)
    throw new MacProcessInspectionError("output-limit", result.exitCode);
}

export async function compileProcessOwner(
  remainingMS: () => number,
): Promise<ProcessOwnerHelper> {
  const sourceSHA256 = digest(await readFile(source));
  const parent = path.join(packageRoot, ".build/process-owner");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await realpath(parent)) !== parent)
    throw new Error("Unsafe process-owner helper directory");
  const directory = await mkdtemp(path.join(parent, "helper-"));
  await chmod(directory, 0o700);
  const filename = path.join(directory, "process-owner");
  const built = await captureProcessTool(
    ["/usr/bin/xcrun", "swiftc", source, "-o", filename],
    inspectionBudget(remainingMS()),
  );
  requireCapturedSuccess(built);
  if (built.exitCode !== 0 || built.stdout !== "")
    throw new Error("Process-owner helper compilation rejected");
  if (
    digest(await readFile(source)) !== sourceSHA256 ||
    digest(await readFile(schemaPath)) !== digest(schemaBytes)
  )
    throw new Error("Process-owner helper inputs changed");
  await chmod(filename, 0o700);
  return {
    filename,
    binarySHA256: digest(await readFile(filename)),
    sourceSHA256,
  };
}

/** Retains a closed rejected response for guard controls; callers must check its outcome. */
export async function invokeProcessOwner(
  helper: ProcessOwnerHelper,
  request: Request,
  remainingMS: () => number,
) {
  if (!requestValidator(request))
    throw new Error("Invalid process-owner request contract");
  const stat = await lstat(helper.filename);
  if (
    !stat.isFile() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    (await realpath(helper.filename)) !== helper.filename ||
    digest(await readFile(helper.filename)) !== helper.binarySHA256 ||
    digest(await readFile(source)) !== helper.sourceSHA256 ||
    digest(await readFile(schemaPath)) !== digest(schemaBytes)
  )
    throw new Error("Process-owner helper identity changed");
  const result = await captureProcessTool(
    [helper.filename],
    inspectionBudget(remainingMS()),
    JSON.stringify(request),
  );
  requireCapturedSuccess(result);
  const raw: unknown = JSON.parse(result.stdout);
  if (!responseValidator(raw))
    throw new Error("Invalid process-owner response contract");
  const response = ResponseSchema.parse(raw);
  if (
    response.operation !== request.operation ||
    response.pid !== request.pid ||
    result.exitCode !== (response.outcome === "rejected" ? 3 : 0)
  )
    throw new Error("Process-owner response lost its request binding");
  return response;
}

async function retireCandidate(
  pid: string,
  executable: string,
  remainingMS: () => number,
) {
  const helper = await compileProcessOwner(remainingMS);
  const request: Request = {
    schemaVersion: 1,
    operation: "inspect",
    pid: Number(pid),
    executable,
    expected: null,
  };
  const inspected = await invokeProcessOwner(helper, request, remainingMS);
  if (inspected.outcome !== "inspected" || inspected.identity === null)
    throw new Error(
      `Owned acceptance process identity rejected: ${inspected.reason ?? "contract"}`,
    );
  const submitted = await invokeProcessOwner(
    helper,
    { ...request, operation: "terminate", expected: inspected.identity },
    remainingMS,
  );
  if (
    submitted.outcome !== "signal-submitted" ||
    !submitted.signalSubmitted ||
    JSON.stringify(submitted.identity) !== JSON.stringify(inspected.identity)
  )
    throw new Error(
      `Owned acceptance process retirement rejected: ${submitted.reason ?? "contract"}`,
    );
}

type RetirementControls = {
  inspect: typeof inspectOwnedMacProcesses;
  retire: typeof retireCandidate;
  now: () => number;
  sleep: (milliseconds: number) => Promise<unknown>;
};
const defaultRetirementControls: RetirementControls = {
  inspect: inspectOwnedMacProcesses,
  retire: retireCandidate,
  now: Date.now,
  sleep: Bun.sleep,
};

/** TERM submission and observed process exit are separate; no replacement owner is adopted. */
export async function stopOwnedMacProcess(
  executable: string,
  remainingMS: () => number,
  controls: RetirementControls = defaultRetirementControls,
) {
  const owned = await controls.inspect(
    executable,
    inspectionBudget(remainingMS()),
  );
  if (owned.length > 1) throw new MacProcessInspectionError("owner-count");
  const pid = owned[0];
  if (pid === undefined) return { signalSubmitted: false, observedExit: true };
  await controls.retire(pid, executable, remainingMS);
  const deadline = controls.now() + Math.min(15_000, remainingMS());
  for (;;) {
    const remaining = Math.min(remainingMS(), deadline - controls.now());
    const owners = await controls.inspect(
      executable,
      inspectionBudget(remaining),
    );
    if (owners.length > 1) throw new MacProcessInspectionError("owner-count");
    if (owners.length === 0)
      return { signalSubmitted: true, observedExit: true };
    if (owners[0] !== pid)
      throw new Error("Owned acceptance process changed during retirement");
    await controls.sleep(Math.min(100, Math.max(0, deadline - controls.now())));
  }
}
