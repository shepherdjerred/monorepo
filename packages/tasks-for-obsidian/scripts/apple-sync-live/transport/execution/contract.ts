import { z } from "zod";
import {
  FileBlobSchema,
  FileFingerprintSchema,
  SHA256Schema,
  RelativePathSchema,
  UuidSchema,
} from "../fields.ts";

export const NativeSelectorSchema = z.enum([
  "LiveSyncVaultUITests/testInitialDownloadUsesTaskNotesConfiguration",
  "LiveSyncVaultUITests/testCaptureEditCompleteUncompleteAndColdRelaunch",
  "LiveSyncVaultUITests/testOfflineCaptureEditAndColdRelaunchRetainPendingChanges",
  "LiveSyncConflictUITests/testEditOwnedTaskWhileOffline",
  "LiveSyncConflictUITests/testPreviewAndKeepBothVersions",
  "LiveSyncLifecycleUITests/testSignOutPreservesPendingTaskAndColdReplica",
  "LiveSyncLifecycleUITests/testReauthorizedReplicaRetainsTaskAndColdRelaunch",
]);
export const NativeLabelSchema = z
  .string()
  .regex(
    /^(?:initial-configuration-macos|capture-macos-[123]|offline-macos|conflict-macos-(?:edit|resolve)|lifecycle-macos-(?:pending|signedout|reauthorized))$/u,
  );
export const OfficialStepSchema = z.enum([
  "create",
  "edit",
  "complete",
  "uncomplete",
]);
const text = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\P{Cc}+$/u);
const remoteID = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\P{Cc}+$/u);
const relative = RelativePathSchema.max(512);
const deadline = z.number().int().positive().max(600_000);
const lifetime = z.strictObject({
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().min(0).max(999_999),
  launchDate: z.number().positive(),
});
export const OfficialAccountActionSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("present") }),
  z.strictObject({ mode: z.literal("inspect") }),
  z.strictObject({
    mode: z.enum(["clear", "probe", "submit"]),
    lifetime,
  }),
  z.strictObject({
    mode: z.literal("fill"),
    email: text,
    password: text,
    lifetime,
  }),
]);
export const OfficialAccountReceiptSchema = z.strictObject({
  ready: z.literal(true),
  pid: z.number().int().positive(),
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().min(0).max(999_999),
  launchDate: z.number().positive(),
  secureField: z.literal(true),
  submitActionCount: z.number().int().min(0).max(1),
  loginEnabled: z.boolean(),
  emailLength: z.number().int().nonnegative().optional(),
  passwordLength: z.number().int().nonnegative().optional(),
  focusedSecureField: z.boolean().optional(),
  cleared: z.boolean().optional(),
  probeReady: z.boolean().optional(),
  submissionAttempted: z.boolean().optional(),
  formBinding: z.string().min(1).max(512).optional(),
});
export const AccountCheckpointSchema = z.strictObject({
  completedRounds: z
    .array(
      z.strictObject({
        round: z.number().int().min(1).max(3),
        evidenceSHA256: SHA256Schema,
      }),
    )
    .max(3),
  stage: z.enum([
    "preparing",
    "owner-setup",
    "bound",
    "initial-verified",
    "failed",
    "cleaned",
  ]),
  officialReferencePassed: z.boolean(),
  initialDownloadPassed: z.boolean(),
  lifecycleBeginPassed: z.boolean(),
  lifecycleFinishPresent: z.boolean(),
  failuresCount: z.number().int().nonnegative(),
  scope: z.enum(["macos", "apple"]),
});
export const NativeExtraSchema = z.strictObject({
  FACET_E2E_ROUND: z.enum(["1", "2", "3"]).optional(),
  FACET_E2E_CAPTURE_PREFIX: z.literal("Lifecycle").optional(),
  FACET_E2E_INITIAL_TASK_TITLE: text.optional(),
  FACET_E2E_CONFLICT_CASE_ID: UuidSchema.optional(),
  FACET_E2E_CONFLICT_ORIGINAL_TITLE: text.optional(),
  FACET_E2E_LIFECYCLE_TITLE: text.optional(),
});
export const AccountModeSchema = z.enum([
  "inspect_onboarding",
  "present_account",
  "inspect_credentials",
  "activate_credentials",
  "fill_credentials",
  "submit_credentials",
  "inspect_verification",
  "activate_verification",
  "verify",
  "inspect_vault",
  "activate_vault",
  "connect",
  "inspect_workspace",
  "present_lifecycle_account",
]);
// Secrets exist only in this private stdin request, never an argv, receipt or journal digest.
const privateAccount = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("fill_credentials"),
    email: text,
    password: text,
    lifetime,
  }),
  z.strictObject({
    mode: z.literal("verify"),
    code: z.string().regex(/^\d{6}$/u),
    requestID: UuidSchema,
    lifetime,
  }),
  z.strictObject({
    mode: z.literal("connect"),
    vaultPassword: text,
    requestID: UuidSchema,
    lifetime,
  }),
  z.strictObject({
    mode: z.enum([
      "present_account",
      "activate_credentials",
      "submit_credentials",
      "activate_verification",
      "activate_vault",
      "present_lifecycle_account",
    ]),
    lifetime,
  }),
  z.strictObject({
    mode: z.enum([
      "inspect_onboarding",
      "inspect_credentials",
      "inspect_verification",
      "inspect_vault",
      "inspect_workspace",
    ]),
  }),
]);
export const ExecutionOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("official-account"),
    action: OfficialAccountActionSchema,
  }),
  z.strictObject({
    kind: z.literal("launch"),
    discovery: z.boolean(),
    timeoutMS: deadline,
  }),
  z.strictObject({ kind: z.literal("retire") }),
  z.strictObject({
    kind: z.literal("descriptor"),
    vaultID: remoteID.nullable(),
  }),
  z.strictObject({ kind: z.literal("verify") }),
  z.strictObject({
    kind: z.literal("checkpoint"),
    checkpoint: AccountCheckpointSchema,
  }),
  z.strictObject({
    kind: z.literal("native"),
    selector: NativeSelectorSchema,
    label: NativeLabelSchema,
    extra: NativeExtraSchema,
    timeoutMS: deadline,
  }),
  z.strictObject({ kind: z.literal("official-info") }),
  z.strictObject({ kind: z.literal("official-launch") }),
  z.strictObject({ kind: z.literal("official-plugin"), exportID: UuidSchema }),
  z.strictObject({
    kind: z.literal("official-step"),
    step: OfficialStepSchema,
  }),
  z.strictObject({
    kind: z.literal("official-publication"),
    relative,
    expectedBytes: z.string().max(4 * 1024 * 1024),
    caseID: UuidSchema,
  }),
  z.strictObject({
    kind: z.literal("account"),
    action: privateAccount,
    lifecycleRound: z.number().int().min(1).max(3).optional(),
    lifecycleCheckpoint: FileBlobSchema.optional(),
  }),
]);
export const ClosedAccountReceiptSchema = z.strictObject({
  runID: UuidSchema.optional(),
  pid: z.number().int().positive().optional(),
  startSeconds: z.number().int().nonnegative().optional(),
  startMicroseconds: z.number().int().min(0).max(999_999).optional(),
  launchDate: z.number().positive().optional(),
  ready: z.boolean().optional(),
  stage: z.enum(["credentials", "verification", "vaults"]).optional(),
  readOnly: z.boolean().optional(),
  requestID: UuidSchema.optional(),
  normalNavigationPressCount: z.number().int().nonnegative().optional(),
  normalAXPressResult: z.number().int().optional(),
  submitActionCount: z.number().int().min(0).max(1).optional(),
  ownedAppActivated: z.boolean().optional(),
  credentialsEntered: z.boolean().optional(),
  clearDisabledCheckpointCount: z.number().int().nonnegative().optional(),
  signInEnabled: z.boolean().optional(),
  blocked: z
    .enum([
      "input",
      "bind-process",
      "process",
      "run",
      "window",
      "field",
      "setter",
      "action",
      "internal",
      "session",
    ])
    .optional(),
  phase: z
    .enum([
      "input",
      "bind-process",
      "process",
      "run",
      "window",
      "field",
      "setter",
      "action",
      "internal",
      "session",
    ])
    .optional(),
});
export const ExecutionResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("official-account"),
    receipt: OfficialAccountReceiptSchema,
  }),
  z.strictObject({
    kind: z.literal("launch"),
    launched: z.literal(true),
    discovery: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("official-launch"),
    launched: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal("official-plugin"),
    version: z.literal("4.13.8"),
  }),
  z.strictObject({
    kind: z.literal("retire"),
    signalSubmitted: z.boolean(),
    observedExit: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal("descriptor"),
    vaultID: remoteID.nullable(),
  }),
  z.strictObject({ kind: z.literal("checkpoint"), written: z.literal(true) }),
  z.strictObject({
    kind: z.literal("verify"),
    artifactSHA256: SHA256Schema,
    payloadSHA256: SHA256Schema,
    sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
    guestConfigSHA256: SHA256Schema,
    runnerInstallationID: UuidSchema,
    captureReady: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("native"),
    selector: NativeSelectorSchema,
    label: NativeLabelSchema,
    evidenceDirectory: relative,
    files: z.array(relative).min(1).max(20_000),
  }),
  z.strictObject({
    kind: z.literal("official-info"),
    officialVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    pluginManifestSHA256: SHA256Schema,
    pluginEvidence: z.strictObject({
      release: z.strictObject({
        id: z.number().int().positive(),
        version: z.literal("4.13.8"),
        url: z.url(),
      }),
      id: z.literal("tasknotes"),
      assets: z.strictObject({
        "main.js": FileFingerprintSchema,
        "manifest.json": FileFingerprintSchema,
        "styles.css": FileFingerprintSchema,
      }),
    }),
  }),
  z.strictObject({
    kind: z.literal("official-step"),
    step: OfficialStepSchema,
    evidenceRelative: relative,
    fingerprint: FileFingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("official-publication"),
    caseID: UuidSchema,
    relative,
    fingerprint: FileFingerprintSchema,
    head: z.strictObject({
      version: z.literal(0),
      timestamp: z.string(),
      storedSize: z.number().int().positive(),
      historyHeadSHA256: SHA256Schema,
    }),
  }),
  z.strictObject({
    kind: z.literal("account"),
    receipt: ClosedAccountReceiptSchema,
  }),
]);
export type ExecutionOperation = z.infer<typeof ExecutionOperationSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
