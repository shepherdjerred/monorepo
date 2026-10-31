import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OfficialVerificationPreparedSchema,
  requireVerificationProof,
  verificationFrame,
  verificationWire,
  verificationProtocol,
  officialTOTPMethodWords,
} from "./official-verification-protocol";
import { runVerificationPreparation } from "./official-verification-guest";
import {
  driveOfficialVerification,
  retainFailedVerification,
  type VerificationIO,
} from "./official-verification-host";
import {
  requireVerificationMeasurement,
  retainVerificationMeasurement,
} from "./official-verification-measurement";
import { parseOfficialAccountArguments } from "./official-host";

test("pinned official TOTP wording accepts the actual canonical label and rejects near misses", () => {
  for (const words of [
    "6-digit 2FA code",
    "Your 2-factor authentication code",
    "two-factor authentication",
  ])
    expect(officialTOTPMethodWords(words)).toBe(true);
  for (const words of [
    "2FA",
    "6-digit 2FA codes",
    "6 digit 2FA code",
    "6-digit 2FA code recovery",
    "6-digit 2FA code sent to email",
    "Check your email inbox for a 6-digit 2FA code",
  ])
    expect(officialTOTPMethodWords(words)).toBe(false);
});

test.each(["guard", "oversize", "malformed", "retention-failure"])(
  "no-code preparation retains bounded evidence before %s rejection",
  async (fault) => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "facet-verification-prepare-test-")),
    );
    try {
      const names = verificationProtocol.frames["prepare"];
      expect(names).toBeDefined();
      if (names === undefined) throw new Error("Missing prepare definition");
      const values: Record<string, unknown> = input;
      const request = Object.fromEntries(
        names.map((name) => [
          name,
          name === "mode" ? "verification-prepare" : values[name],
        ]),
      );
      const evidence = path.join(directory, "preparation-" + sessionID);
      const diagnostic = {
        blocked: "form",
        phase: "verification-form",
        submitActionCount: 0,
      };
      const stdout = Buffer.from(
        fault === "oversize"
          ? "x".repeat(9000)
          : fault === "malformed"
            ? "{"
            : JSON.stringify(diagnostic),
      );
      await expect(
        runVerificationPreparation(
          path.join(directory, "helper"),
          request,
          async (_argv, frame) => {
            expect(
              JSON.parse(new TextDecoder().decode(frame)),
            ).not.toHaveProperty("code");
            if (fault === "retention-failure")
              await writeFile(
                path.join(evidence, "stdout"),
                "existing-public-fixture",
              );
            return {
              stdout,
              stderr: Buffer.from("public native diagnostic"),
              exitCode: 3,
            };
          },
        ),
      ).rejects.toThrow(
        fault === "retention-failure"
          ? "evidence retention failed"
          : fault === "oversize"
            ? "output exceeded bound"
            : "preparation failed",
      );
      const retainedOutput = await readFile(path.join(evidence, "stdout"));
      expect(retainedOutput.length).toBeLessThanOrEqual(8192);
      expect(await readFile(path.join(evidence, "stderr"), "utf8")).toBe(
        "public native diagnostic",
      );
      const exit = JSON.parse(
        await readFile(path.join(evidence, "exit.json"), "utf8"),
      );
      expect(exit.exitCode).toBe(3);
      expect(exit.binding.configSHA256).toBe(input.configSHA256);
      expect(exit.stdoutTruncated).toBe(fault === "oversize");
      if (fault !== "retention-failure") {
        const retained = JSON.parse(
          await readFile(path.join(evidence, "diagnostic.json"), "utf8"),
        );
        expect(retained.classification).toBe(
          fault === "guard"
            ? "native-guard"
            : fault === "oversize"
              ? "output-bound"
              : "unclassified",
        );
        if (fault === "guard") expect(retained.native).toEqual(diagnostic);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("no-code preparation transport failure keeps a closed bound receipt without arbitrary errors", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-verification-transport-test-")),
  );
  try {
    const fields = verificationProtocol.frames["prepare"];
    if (fields === undefined) throw new Error("Missing prepare definition");
    const values: Record<string, unknown> = input;
    const request = Object.fromEntries(
      fields.map((name) => [
        name,
        name === "mode" ? "verification-prepare" : values[name],
      ]),
    );
    await expect(
      runVerificationPreparation(
        path.join(directory, "helper"),
        request,
        async () => {
          throw new Error("synthetic untrusted child error");
        },
      ),
    ).rejects.toThrow("preparation transport failed");
    const text = await readFile(
      path.join(directory, "preparation-" + sessionID, "diagnostic.json"),
      "utf8",
    );
    expect(text).not.toContain("untrusted child error");
    expect(JSON.parse(text)).toMatchObject({
      classification: "transport-failed",
      rawResponseAvailable: false,
      binding: { configSHA256: input.configSHA256 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed cleanup cannot skip independent fake evidence retention", async () => {
  const calls: string[] = [];
  const result = await retainFailedVerification(
    async () => {
      calls.push("abort");
      throw new Error("synthetic cleanup failure");
    },
    async () => {
      calls.push("retain");
    },
  );
  expect(calls).toEqual(["abort", "retain"]);
  expect(result).toBe("cleanup-failed");
  expect(
    await retainFailedVerification(
      async () => {
        return;
      },
      async () => {
        throw new Error("synthetic retention failure");
      },
    ),
  ).toBe("retention-failed");
});

const runID = "12345678-1234-4234-9234-123456789abc",
  sessionID = "22345678-1234-4234-9234-123456789abc",
  challengeID = "32345678-1234-4234-9234-123456789abc";
const input = {
  purpose: "live",
  mode: "verification-session",
  operation: "verify",
  runID,
  sessionID,
  challengeID,
  referenceDirectory: "/owned/reference-vault",
  officialExportID: runID,
  executable: "/owned/Obsidian",
  pid: 123,
  startSeconds: 100,
  startMicroseconds: 0,
  launchDate: 100,
  configFile: "/owned/live-config.json",
  configSHA256: "a".repeat(64),
  binarySHA256: "b".repeat(64),
};
const prepared = OfficialVerificationPreparedSchema.parse({
  program: "/owned/official-account",
  binarySHA256: input.binarySHA256,
  input,
});
const ready = {
  kind: "ready",
  runID,
  sessionID,
  challengeID,
  pid: 123,
  startSeconds: 100,
  startMicroseconds: 0,
  launchDate: 100,
  clockEpochMs: 100_000,
  formKind: "totp",
  codeFieldSecure: false,
  loginEnabled: true,
};
const finished = {
  kind: "finished",
  runID,
  sessionID,
  challengeID,
  cleared: false,
  codeLength: 6,
  submitActionCount: 1,
};
const proof = {
  ...ready,
  kind: "proof",
  schemaVersion: 1,
  configSHA256: input.configSHA256,
  binarySHA256: input.binarySHA256,
  cleared: true,
  codeLength: 6,
  submitActionCount: 0,
};
const { clockEpochMs: _clock, loginEnabled: _enabled, ...validProof } = proof;

describe("official TOTP private phase", () => {
  test("shared frames reject secret echoes, wrong phases and malformed codes without returning values", () => {
    expect(verificationFrame("ready", ready)).toEqual(ready);
    const code = {
      kind: "code",
      runID,
      sessionID,
      challengeID,
      code: "246802",
      issuedAtEpochMs: 100_000,
      validUntilEpochMs: 130_000,
    };
    expect(verificationWire("code", code).length).toBeGreaterThan(0);
    for (const invalid of [
      { ...ready, codeFieldSecure: true },
      { ...ready, formKind: "credentials" },
      { ...ready, code: "synthetic-secret" },
      { ...ready, pid: 0 },
    ])
      expect(() => verificationFrame("ready", invalid)).toThrow(
        "frame rejected",
      );
    for (const value of ["12345", "1234567", "12345\n", "abcdef"]) {
      let error: unknown;
      try {
        verificationFrame("code", { ...code, code: value });
      } catch (error_) {
        error = error_;
      }
      expect(String(error)).toBe("Error: Official verification frame rejected");
    }
  });
  test("code proof binds exact form, process, binary and plaintext OTP phase", () => {
    expect(requireVerificationProof(validProof, prepared)).toEqual(validProof);
    for (const invalid of [
      { ...validProof, challengeID: crypto.randomUUID() },
      { ...validProof, binarySHA256: "c".repeat(64) },
      { ...validProof, pid: 456 },
      { ...validProof, cleared: false },
      { ...validProof, submitActionCount: 1 },
      { ...validProof, codeLength: 5 },
      { ...validProof, codeFieldSecure: true },
    ])
      expect(() => requireVerificationProof(invalid, prepared)).toThrow();
  });
  test("real code is requested only after native READY and final expensive checks, then sent once", async () => {
    const order: string[] = [];
    let reads = 0;
    const io: VerificationIO = {
      send: async (kind) => {
        order.push("send:" + kind);
      },
      read: async () => {
        reads++;
        order.push(reads === 1 ? "native-ready" : "native-finished");
        return reads === 1 ? ready : finished;
      },
      finish: async () => {
        order.push("finish");
      },
      abort: async () => {
        order.push("abort");
      },
    };
    await driveOfficialVerification(prepared, "verify", io, {
      now: () => 100_000,
      fresh: async () => {
        order.push("expensive-checks");
      },
      readCode: async () => {
        order.push("generate-code");
        return {
          code: "246802",
          issuedAtEpochMs: 100_000,
          validUntilEpochMs: 130_000,
        };
      },
      markSubmitting: () => {
        order.push("mark-unknown-before-send");
      },
    });
    expect(order).toEqual([
      "send:init",
      "native-ready",
      "expensive-checks",
      "generate-code",
      "mark-unknown-before-send",
      "send:code",
      "native-finished",
      "finish",
    ]);
  });
  test.each([
    "foreign-challenge",
    "clock-skew",
    "expired",
    "source-change",
    "native-failure",
  ] as const)("%s blocks any real code transfer", async (fault) => {
    const sends: string[] = [];
    let generated = 0;
    const io: VerificationIO = {
      send: async (kind) => {
        sends.push(kind);
      },
      read: async () =>
        fault === "native-failure"
          ? { blocked: "form" }
          : fault === "foreign-challenge"
            ? { ...ready, challengeID: runID }
            : fault === "clock-skew"
              ? { ...ready, clockEpochMs: 1 }
              : ready,
      finish: async () => {
        return;
      },
      abort: async () => {
        return;
      },
    };
    await expect(
      driveOfficialVerification(prepared, "verify", io, {
        now: () => 100_000,
        fresh: async () => {
          if (fault === "source-change") throw new Error("changed");
        },
        readCode: async () => {
          generated++;
          return {
            code: "246802",
            issuedAtEpochMs: 100_000,
            validUntilEpochMs: 105_000,
          };
        },
        markSubmitting: () => {
          return;
        },
      }),
    ).rejects.toThrow();
    expect(sends).toEqual(["init"]);
    expect(generated).toBe(fault === "expired" ? 1 : 0);
  });
  test("fake code probe never invokes cached credentials and requires zero submits/clear", async () => {
    let count = 0;
    const sends: string[] = [];
    const io: VerificationIO = {
      send: async (kind) => {
        sends.push(kind);
      },
      read: async () =>
        ++count === 1
          ? ready
          : { ...finished, cleared: true, submitActionCount: 0 },
      finish: async () => {
        return;
      },
      abort: async () => {
        return;
      },
    };
    await driveOfficialVerification(prepared, "probe", io, {
      now: () => 100_000,
      fresh: async () => {
        return;
      },
      readCode: async () => {
        throw new Error("must never read credentials");
      },
      markSubmitting: () => {
        throw new Error("must never submit");
      },
    });
    expect(sends).toEqual(["init", "probe"]);
  });
  test("MFA CLI exposes a separate local-only action and no password resubmit", () => {
    expect(
      parseOfficialAccountArguments([runID, "verification-probe"]).operation,
    ).toBe("verification-probe");
    expect(
      parseOfficialAccountArguments([
        runID,
        "verification",
        "--account",
        "a".repeat(26),
        "--vault",
        "b".repeat(26),
        "--item",
        "c".repeat(26),
      ]).credentialBackend,
    ).toBe("keychain");
    expect(() =>
      parseOfficialAccountArguments([
        runID,
        "verification-probe",
        "--item",
        "c".repeat(26),
      ]),
    ).toThrow();
  });
});

test("only fully measured successful fake streams authorize OTP; failed streams stay retained", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-official-measurement-test-")),
  );
  try {
    // This test owns its namespace and never touches a prepared real run.
    const owned = OfficialVerificationPreparedSchema.parse({
      ...prepared,
      input: { ...input, runID: crypto.randomUUID() },
    });
    const makeCapture = (value: typeof owned) => ({
      stdout: Buffer.concat([
        verificationWire("ready", { ...ready, runID: value.input["runID"] }),
        verificationWire("finished", {
          ...finished,
          runID: value.input["runID"],
          cleared: true,
          submitActionCount: 0,
        }),
      ]),
      stderr: new Uint8Array(0),
    });
    const storage = { rootDirectory: directory };
    await retainVerificationMeasurement(
      owned,
      makeCapture(owned),
      true,
      storage,
    );
    await expect(
      requireVerificationMeasurement(owned, storage),
    ).resolves.toBeUndefined();
    const file = path.join(directory, "probes", sessionID, "stdout");
    await writeFile(file, "changed");
    await expect(
      requireVerificationMeasurement(owned, storage),
    ).rejects.toThrow();
    const failed = OfficialVerificationPreparedSchema.parse({
      ...owned,
      input: { ...owned.input, sessionID: crypto.randomUUID() },
    });
    const leaked = {
      stdout: Buffer.from("135790"),
      stderr: Buffer.from("synthetic diagnostic"),
    };
    await expect(
      retainVerificationMeasurement(failed, leaked, true, {
        rootDirectory: path.join(directory, "failure"),
      }),
    ).rejects.toThrow("privacy measurement failed");
    const evidence = JSON.parse(
      await readFile(
        path.join(
          directory,
          "failure",
          "probes",
          String(failed.input["sessionID"]),
          "measurement.json",
        ),
        "utf8",
      ),
    );
    expect(evidence.passed).toBe(false);
    await expect(
      requireVerificationMeasurement(failed, {
        rootDirectory: path.join(directory, "failure"),
      }),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
