import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  assertFreshInitialStatus,
  bindingFor,
  childEnvironment,
  classifyPasswordManagerFailure,
  exactPID,
  parseArguments,
  runDirectory,
  selectCredentials,
} from "./mac-account-contract.ts";
import { requiredCases } from "../../tasks-for-obsidian/scripts/apple-sync-live/model.ts";
import { closedReceipt, main } from "./mac-account.ts";
import {
  assertMacInputCorrelation,
  MacInputPreparedSchema,
} from "../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/account-input/protocol";

const runID = "11111111-1111-4111-a111-111111111abc";
const remote = "synthetic-remote";
const container = path.join(
  homedir(),
  "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data",
);
const stateDirectory = path.join(
  container,
  "Library/Application Support/FacetAcceptance",
  runID,
);
const descriptor = {
  schemaVersion: 1,
  runID,
  stateDirectory,
  allowedRemoteVaultID: remote,
};
const client = {
  container,
  stateDirectory,
  descriptor: path.join(stateDirectory, "acceptance.json"),
};
function manifest() {
  return {
    schemaVersion: 2,
    scope: "macos",
    runID,
    createdAt: "2026-10-12T00:00:00Z",
    round: 1,
    failures: [],
    completedRounds: [],
    operations: {},
    stage: "bound",
    allowedRemoteVaultID: remote,
    reference: {},
    pluginFixtureSHA256: "a".repeat(64),
    cases: Object.fromEntries(
      requiredCases.map((name) => [
        name,
        name === "official-reference" ? "pass" : "pending",
      ]),
    ),
    simulator: null,
    clients: { macos: client },
  };
}
function status() {
  return {
    schemaVersion: 1,
    runID,
    capturedAt: "2026-10-12T00:00:00Z",
    profiles: [],
    accountStage: "credentials",
    accountBusy: false,
    accountExchange: null,
  };
}

describe("Mac account runtime confinement", () => {
  test("binds only the declared Mac-only scope and exact owned descriptor", () => {
    expect(bindingFor(runID, manifest(), descriptor).executable).toBe(
      path.join(
        runDirectory(runID),
        "macos/Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
      ),
    );
    for (const invalid of [
      { ...manifest(), schemaVersion: 1, scope: undefined },
      { ...manifest(), clients: { macos: client, ios: client } },
      { ...manifest(), stage: "owner-setup" },
      {
        ...manifest(),
        cases: { ...manifest().cases, "official-reference": "pending" },
      },
      {
        ...manifest(),
        clients: { macos: { ...client, container: "/tmp/other" } },
      },
    ])
      expect(() => bindingFor(runID, invalid, descriptor)).toThrow();
    expect(() =>
      bindingFor(runID, manifest(), {
        ...descriptor,
        allowedRemoteVaultID: "another-remote",
      }),
    ).toThrow();
    expect(() =>
      bindingFor(runID, manifest(), { ...descriptor, extra: true }),
    ).toThrow();
  });

  test("requires fresh closed initial status and blocks existing-profile lifecycle reuse", () => {
    const now = Date.parse(status().capturedAt);
    expect(() => assertFreshInitialStatus(status(), runID, now)).not.toThrow();
    expect(() =>
      assertFreshInitialStatus(
        { ...status(), runID: runID.toUpperCase() },
        runID,
        now,
      ),
    ).not.toThrow();
    for (const invalid of [
      { ...status(), runID: crypto.randomUUID() },
      { ...status(), accountBusy: true },
      { ...status(), extra: "synthetic-secret" },
      { ...status(), profiles: [{}] },
    ])
      expect(() => assertFreshInitialStatus(invalid, runID, now)).toThrow();
    expect(() =>
      assertFreshInitialStatus(status(), runID, now + 5001),
    ).toThrow();
    expect(() =>
      assertFreshInitialStatus(status(), runID, now - 1001),
    ).toThrow();
  });

  test("requires one exact executable process without basename matching", () => {
    expect(exactPID(" 12 /tmp/exact\n13 /tmp/other\n", "/tmp/exact")).toBe(12);
    expect(() => exactPID("12 /tmp/other/exact\n", "/tmp/exact")).toThrow();
    expect(() =>
      exactPID("12 /tmp/exact\n13 /tmp/exact\n", "/tmp/exact"),
    ).toThrow();
    expect(() => exactPID("0 /tmp/exact\n", "/tmp/exact")).toThrow();
  });

  test("accepts nonsecret locators only and rejects ambiguous or option-shaped targets", () => {
    expect(parseArguments(["--", runID, "present"]).operation).toBe("present");
    expect(
      parseArguments([
        runID,
        "credentials",
        "--account",
        "A".repeat(26),
        "--vault",
        "b".repeat(26),
        "--item",
        "c".repeat(26),
      ]).operation,
    ).toBe("credentials");
    for (const args of [
      [runID, "credentials"],
      [runID, "present", "--password", "synthetic-secret"],
      [runID, "vault", "--vault-password-ref", "op://wrong/item/field"],
      [runID, "present", "--item", "--reveal"],
    ])
      expect(() => parseArguments(args)).toThrow();
  });

  test("two-phase Mac probe accepts no credential locators, backend or lifecycle override", () => {
    expect(parseArguments([runID, "probe"])).toEqual({
      runID,
      operation: "probe",
      parameters: {},
      lifecycleRound: undefined,
    });
    for (const option of [
      "--account",
      "--credential-backend",
      "--vault-password-ref",
      "--lifecycle-round",
    ])
      expect(() =>
        parseArguments([runID, "probe", option, "synthetic"]),
      ).toThrow();
  });

  test("Mac verification requires the cached expiry-bearing backend before any input", () => {
    const options = [
      "--account",
      "A".repeat(26),
      "--vault",
      "b".repeat(26),
      "--item",
      "c".repeat(26),
    ];
    expect(
      parseArguments([runID, "verification", ...options]).parameters[
        "--credential-backend"
      ],
    ).toBe("keychain");
    for (const backend of ["desktop", "service-account"])
      expect(() =>
        parseArguments([
          runID,
          "verification",
          ...options,
          "--credential-backend",
          backend,
        ]),
      ).toThrow();
  });
});

describe("credential and output hygiene", () => {
  test("private preparation must match the requested operation and session before input", () => {
    const prepared = MacInputPreparedSchema.parse({
      kind: "mac-input-prepared",
      program: "/private/tmp/synthetic/helper",
      evidenceDirectory: "/private/tmp/synthetic/evidence",
      probe: false,
      input: {
        schemaVersion: 1,
        kind: "mac-private-account-input",
        mode: "private_session",
        operation: "credentials",
        sessionID: runID,
        runID,
        remoteID: remote,
        runDirectory: "/private/tmp/synthetic",
        executable: "/private/tmp/synthetic/app",
        container: "/private/tmp/synthetic/container",
        stateDirectory: "/private/tmp/synthetic/state",
        lifecycle: null,
        guestConfigSHA256: "a".repeat(64),
        pid: 123,
        startSeconds: 456,
        startMicroseconds: 789,
        launchDate: 456.000789,
        requestID: null,
        helperSHA256: "b".repeat(64),
        protocolSHA256: "c".repeat(64),
        timingSHA256: "d".repeat(64),
        approvalSHA256: "e".repeat(64),
      },
    });
    expect(() =>
      assertMacInputCorrelation(prepared, "credentials", runID),
    ).not.toThrow();
    expect(() =>
      assertMacInputCorrelation(prepared, "verification", runID),
    ).toThrow("operation changed");
    expect(() =>
      assertMacInputCorrelation(
        prepared,
        "credentials",
        "22222222-2222-4222-a222-222222222abc",
      ),
    ).toThrow("request changed");
  });
  test("selects exactly one credential field from the exact item and vault", () => {
    const item = {
      id: "item",
      vault: { id: "vault" },
      fields: [
        { id: "username", value: "synthetic@example.invalid" },
        { id: "password", value: "synthetic-secret" },
      ],
    };
    expect(selectCredentials(item, "item", "vault")).toEqual({
      email: "synthetic@example.invalid",
      password: "synthetic-secret",
    });
    expect(() => selectCredentials(item, "other", "vault")).toThrow();
    expect(() => selectCredentials(item, "item", "other")).toThrow();
    expect(() =>
      selectCredentials(
        { ...item, fields: [...item.fields, item.fields[0]] },
        "item",
        "vault",
      ),
    ).toThrow();
    expect(() =>
      selectCredentials(
        {
          ...item,
          fields: [{ id: "username", value: "********" }, item.fields[1]],
        },
        "item",
        "vault",
      ),
    ).toThrow();
  });

  test("does not pass ambient secrets or service tokens into child environments", () => {
    expect(
      childEnvironment({
        HOME: "/tmp/home",
        PATH: "/bin",
        OP_SERVICE_ACCOUNT_TOKEN: "synthetic-service-token",
        OP_SESSION_example: "synthetic-session",
        SECRET: "synthetic-secret",
      }),
    ).toEqual({ HOME: "/tmp/home", PATH: "/bin" });
  });

  test("classifies password-manager failures without returning raw diagnostics", () => {
    expect(
      classifyPasswordManagerFailure("permission denied synthetic-secret"),
    ).toBe("permission");
    expect(
      classifyPasswordManagerFailure("no one-time password synthetic-secret"),
    ).toBe("missing_otp");
    expect(classifyPasswordManagerFailure("synthetic-secret")).toBe("unknown");
  });

  test("rejects unknown receipt fields and arbitrary strings before stdout", () => {
    expect(closedReceipt({ runID, ready: true, submitActionCount: 0 })).toEqual(
      { runID, ready: true, submitActionCount: 0 },
    );
    expect(() => closedReceipt({ password: "synthetic-secret" })).toThrow();
    expect(() => closedReceipt({ phase: "synthetic-secret" })).toThrow();
    expect(() =>
      closedReceipt({ stage: { toString: () => "vaults" } }),
    ).toThrow();
  });

  test("CLI contract failures emit a fixed classification, never supplied data", async () => {
    const lines: unknown[][] = [];
    const logger = vi
      .spyOn(console, "log")
      .mockImplementation((...values: unknown[]) => {
        lines.push(values);
      });
    try {
      expect(
        await main([runID, "present", "--password", "synthetic-secret"]),
      ).toBe(3);
    } finally {
      logger.mockRestore();
    }
    expect(lines).toEqual([
      [
        JSON.stringify({
          blocked: "driver_contract",
          submissionStatus: "not_attempted",
        }),
      ],
    ]);
    expect(JSON.stringify(lines)).not.toContain("synthetic-secret");
  });

  test("native helper addresses normal key events to proven focused fields without reading values", async () => {
    const source = (
      await Promise.all(
        [
          "main.swift",
          "AccountRuntime.swift",
          "AccountOwner.swift",
          "AccountLifecycle.swift",
          "MacAccountProtocol.swift",
          "MacAccountIO.swift",
          "MacAccountSession.swift",
        ].map((name) =>
          readFile(
            path.join(import.meta.dir, "native/mac-account", name),
            "utf8",
          ),
        ),
      )
    ).join("\n");
    expect(source).not.toMatch(/attr\([^\n]*"AXValue"/u);
    expect(source).toContain(
      'AXUIElementSetAttributeValue(target, "AXFocused"',
    );
    expect(source).toMatch(
      /same\(attr\(root,\s*"AXFocusedUIElement"\),\s*current\)/u,
    );
    expect(source).toMatch(
      /down\.postToPid\(pid\)\s*;?\s*up\.postToPid\(pid\)/u,
    );
    expect(source).not.toContain(".post(tap:");
    expect(source).toContain("keyboardSetUnicodeString");
    expect(source).toContain("CGSSessionScreenIsLocked");
    expect(source).not.toContain("83884152-6988-4771-a44e-7becc364c934");
    expect(source).not.toContain("iosContainer");
    expect(source).toContain('"facet.account.reconnect." + $0.profileID');
    expect(source).toContain('matches(menu, identifier: "facet.account.open")');
  });
});
