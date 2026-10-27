import { expect, test } from "vitest";
import {
  ClosedAccountReceiptSchema,
  ExecutionOperationSchema,
  ExecutionResultSchema,
} from "./contract.ts";
import { requireNativeLabel } from "./native.ts";
import { readHostCredentialItem } from "./credential-host.ts";

const native = {
  kind: "native" as const,
  selector:
    "LiveSyncVaultUITests/testCaptureEditCompleteUncompleteAndColdRelaunch" as const,
  label: "capture-macos-1",
  extra: { FACET_E2E_ROUND: "1" as const },
  timeoutMS: 180_000,
};
test("guest execution rejects arbitrary commands, paths and protected native environment overrides", () => {
  expect(() => ExecutionOperationSchema.parse(native)).not.toThrow();
  for (const value of [
    { kind: "exec", argv: ["sh", "-c", "anything"] },
    { ...native, argv: ["anything"] },
    { ...native, selector: "OtherSuite/testNotAuthorized" },
    { ...native, label: "../foreign" },
    { ...native, extra: { FACET_E2E_DESCRIPTOR: "/foreign" } },
    { ...native, extra: { OP_SERVICE_ACCOUNT_TOKEN: "synthetic-forbidden" } },
    {
      kind: "official-publication",
      relative: "../secret",
      expectedBytes: "",
      caseID: crypto.randomUUID(),
    },
  ])
    expect(() => ExecutionOperationSchema.parse(value)).toThrow();
});
test("selected native label and round must describe the exact selected existing journey", () => {
  const parsed = ExecutionOperationSchema.parse(native);
  if (parsed.kind !== "native") throw new Error("Wrong fixture");
  expect(() => requireNativeLabel(parsed, 1)).not.toThrow();
  expect(() => requireNativeLabel(parsed, 2)).toThrow();
  expect(() =>
    requireNativeLabel({ ...parsed, label: "initial-configuration-macos" }, 1),
  ).toThrow();
});
test("account inspection cannot carry secrets and native receipts cannot echo credentials", () => {
  expect(() =>
    ExecutionOperationSchema.parse({
      kind: "account",
      action: { mode: "inspect_credentials" },
    }),
  ).not.toThrow();
  expect(() =>
    ExecutionOperationSchema.parse({
      kind: "account",
      action: { mode: "inspect_credentials", password: "synthetic-forbidden" },
    }),
  ).toThrow();
  expect(() =>
    ClosedAccountReceiptSchema.parse({
      runID: crypto.randomUUID(),
      ready: true,
      password: "synthetic-forbidden",
    }),
  ).toThrow();
});
test("invalid1Password locators fail before invoking the password manager", () => {
  expect(() =>
    readHostCredentialItem({
      "--account": "invalid",
      "--vault": "invalid",
      "--item": "invalid",
    }),
  ).toThrow();
});
test("official helper rejection preserves only closed blocked and phase enums", () => {
  const receipt = { blocked: "form", phase: "owner", submitActionCount: 0 };
  expect(() =>
    ExecutionResultSchema.parse({ kind: "official-account", receipt }),
  ).not.toThrow();
  for (const rejected of [
    { ...receipt, phase: "unexpected-dynamic-error" },
    { ...receipt, blocked: "raw process error" },
    { ...receipt, password: "forbidden" },
    { ...receipt, stdout: "forbidden" },
    { ...receipt, submitActionCount: 1 },
  ])
    expect(() =>
      ExecutionResultSchema.parse({
        kind: "official-account",
        receipt: rejected,
      }),
    ).toThrow();
});
