import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ExecutionOperation, ExecutionResult } from "./contract.ts";
import {
  OfficialAccountReceiptSchema,
  OfficialAccountFailureSchema,
} from "./contract.ts";
import { executePrivateTransport } from "../host.ts";
import { inspectOwnedMacProcesses } from "../../mac-process-inspection.ts";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import type { GuestRuntime } from "./runtime.ts";
import { officialRead } from "./official.ts";
import { parseOfficialEvalBoolean } from "./official-read.ts";
import {
  officialProbeReady,
  officialProbePath,
  retainOfficialProbe,
  officialSubmissionAttempted,
  retainOfficialSubmission,
} from "./official-proof.ts";

const accountDocument = "app.setting.modalEl.ownerDocument";
const loginForm = `Array.from(d.querySelectorAll('.modal.mod-form')).filter(e=>e.querySelector('.modal-title')?.textContent==='Log in to Obsidian')`;
async function normalAccountAction(
  runtime: GuestRuntime,
  action: "present" | "submit",
  formBinding?: string,
): Promise<void> {
  const code =
    action === "present"
      ? `(()=>{app.setting.open();return true})()`
      : `(()=>{const d=${accountDocument};const m=${loginForm};if(m.length!==1||m[0].getAttribute('data-facet-official-input')!==${JSON.stringify(formBinding)})throw Error('form-binding');const b=Array.from(m[0].querySelectorAll('button')).filter(e=>e.textContent.trim()==='Log in');if(b.length!==1||b[0].disabled)throw Error('button');b[0].click();return true})()`;
  assert.equal(
    parseOfficialEvalBoolean(
      await officialRead(runtime, ["eval", `code=${code}`]),
    ),
    true,
  );
  if (action === "submit") return;
  const deadline = Date.now() + 5000;
  for (;;) {
    const ready = `(()=>{const d=${accountDocument};if(!app.setting.modalEl.isConnected)return false;const existing=${loginForm};if(existing.length===1)return true;const b=Array.from(d.querySelectorAll('button')).filter(e=>e.textContent.trim()==='Log in');if(b.length!==1||b[0].disabled)throw Error('button');b[0].click();return (${loginForm}).length===1})()`;
    if (
      parseOfficialEvalBoolean(
        await officialRead(runtime, ["eval", `code=${ready}`]),
      )
    )
      return;
    assert.ok(
      Date.now() < deadline,
      "Official normal account form did not become available",
    );
    await Bun.sleep(50);
  }
}
/** Values travel only through private stdin to the same guarded helper proven with public fake data. */
export async function runGuestOfficialAccount(
  runtime: GuestRuntime,
  operation: Extract<ExecutionOperation, { kind: "official-account" }>,
): Promise<ExecutionResult> {
  const { action } = operation;
  if (action.mode === "fill" || action.mode === "submit") {
    assert.equal(
      await officialProbeReady(runtime),
      true,
      "Current integrated private input probe must pass before credentials",
    );
    assert.equal(
      await officialSubmissionAttempted(runtime),
      false,
      "Inspect the retained submission before any further credential operation",
    );
  }
  if (action.mode === "probe")
    assert.equal(
      await Bun.file(officialProbePath(runtime)).exists(),
      false,
      "Read the retained probe before repeating its input",
    );
  if (action.mode === "present") await normalAccountAction(runtime, "present");
  const executable = path.join(
    runtime.paths.officialApp,
    "Contents/MacOS/Obsidian",
  );
  const owners = await inspectOwnedMacProcesses(executable, 5000);
  assert.equal(owners.length, 1);
  const pid = z.coerce.number().int().positive().parse(owners[0]);
  const directory = path.join(
    runtime.paths.evidenceDirectory,
    "official-account",
    crypto.randomUUID(),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = path.join(
    runtime.exportRoot,
    "live-helpers/official-account.swift",
  );
  assert.equal(
    await macFileSHA(source),
    runtime.config.helpers["official-account.swift"],
  );
  const copied = path.join(directory, "main.swift");
  await copyFile(source, copied, 1);
  const ownerSource = path.join(
    runtime.exportRoot,
    "live-helpers/OfficialOwner.swift",
  );
  assert.equal(
    await macFileSHA(ownerSource),
    runtime.config.helpers["OfficialOwner.swift"],
  );
  const ownerCopy = path.join(directory, "OfficialOwner.swift");
  await copyFile(ownerSource, ownerCopy, 1);
  const containerSource = path.join(
    runtime.exportRoot,
    "live-helpers/OfficialAccountContainer.swift",
  );
  assert.equal(
    await macFileSHA(containerSource),
    runtime.config.helpers["OfficialAccountContainer.swift"],
  );
  const containerCopy = path.join(directory, "OfficialAccountContainer.swift");
  await copyFile(containerSource, containerCopy, 1);
  const verificationSource = path.join(
    runtime.exportRoot,
    "live-helpers/OfficialVerification.swift",
  );
  assert.equal(
    await macFileSHA(verificationSource),
    runtime.config.helpers["OfficialVerification.swift"],
  );
  const verificationCopy = path.join(directory, "OfficialVerification.swift");
  await copyFile(verificationSource, verificationCopy, 1);
  const helper = path.join(directory, "official-account");
  await runtime.command([
    "xcrun",
    "swiftc",
    ownerCopy,
    containerCopy,
    verificationCopy,
    copied,
    "-o",
    helper,
  ]);
  await chmod(helper, 0o700);
  const helperSHA = await macFileSHA(helper);
  const invoke = async (mode: "inspect" | "fill" | "clear" | "probe") => {
    assert.equal(
      await macFileSHA(source),
      runtime.config.helpers["official-account.swift"],
    );
    assert.equal(await macFileSHA(helper), helperSHA);
    assert.equal(
      await macFileSHA(verificationSource),
      runtime.config.helpers["OfficialVerification.swift"],
    );
    assert.equal(
      await macFileSHA(ownerSource),
      runtime.config.helpers["OfficialOwner.swift"],
    );
    const privateFields =
      action.mode === "fill"
        ? { email: action.email, password: action.password }
        : {};
    const packet = {
      ...privateFields,
      ...(mode !== "inspect" && "lifetime" in action ? action.lifetime : {}),
      purpose: "live",
      mode,
      runID: runtime.config.runID,
      referenceDirectory: runtime.paths.referenceDirectory,
      officialExportID: runtime.config.officialApp.exportID,
      executable,
      pid,
      configFile: path.join(runtime.exportRoot, "live-config.json"),
      configSHA256: runtime.expectedConfigSHA,
    };
    const result = await executePrivateTransport(
      [helper],
      new TextEncoder().encode(JSON.stringify(packet)),
      60_000,
    );
    assert.equal(result.stderr.length, 0);
    const raw: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
    );
    if (result.exitCode === 3) {
      const failure = OfficialAccountFailureSchema.parse(raw);
      await writeFile(
        path.join(directory, "failure.json"),
        JSON.stringify({
          schemaVersion: 1,
          runID: runtime.config.runID,
          guestConfigSHA256: runtime.expectedConfigSHA,
          helperSHA256: helperSHA,
          failure,
        }),
        { flag: "wx", mode: 0o600 },
      );
      return failure;
    }
    assert.equal(
      result.exitCode,
      0,
      "Unexpected official helper exit; inspect state before repeating",
    );
    return OfficialAccountReceiptSchema.parse(raw);
  };
  const mode = ["present", "submit"].includes(action.mode)
    ? "inspect"
    : action.mode;
  const receipt = await invoke(
    z.enum(["inspect", "fill", "clear", "probe"]).parse(mode),
  );
  if ("blocked" in receipt) return { kind: "official-account", receipt };
  if (action.mode === "submit") {
    assert.equal(receipt.startSeconds, action.lifetime.startSeconds);
    assert.equal(receipt.startMicroseconds, action.lifetime.startMicroseconds);
    assert.equal(receipt.launchDate, action.lifetime.launchDate);
    assert.ok(
      (receipt.emailLength ?? 0) > 0 && (receipt.passwordLength ?? 0) > 0,
    );
    await retainOfficialSubmission(runtime, receipt);
    assert.ok(receipt.formBinding);
    await normalAccountAction(runtime, "submit", receipt.formBinding);
    return {
      kind: "official-account",
      receipt: { ...receipt, submitActionCount: 1 },
    };
  }
  if (action.mode === "probe")
    await retainOfficialProbe(runtime, helperSHA, receipt);
  return {
    kind: "official-account",
    receipt: {
      ...receipt,
      probeReady: await officialProbeReady(runtime),
      submissionAttempted: await officialSubmissionAttempted(runtime),
    },
  };
}
