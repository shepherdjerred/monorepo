import { expect, test, vi } from "vitest";
import {
  assertLocalEnrollmentReady,
  readInstalledLocalAccount,
  enrollLocalAccount,
  type LocalCommand,
} from "./broker.ts";
import { enrollFromDesktop } from "./enrollment.ts";
import { parseLocalCredentialArguments } from "../local-credentials.ts";
import {
  installLocalHelper,
  helperSigning,
  signatureRequirement,
  requireHelperProvenance,
} from "./helper.ts";
import { sanitizeEnrollment } from "./payload.ts";

const locator = {
  account: "A".repeat(26),
  vault: "b".repeat(26),
  item: "c".repeat(26),
};
const original = {
  category: "LOGIN",
  id: locator.item,
  vault: { id: locator.vault },
  fields: [
    { id: "username", value: "synthetic@example.invalid" },
    { id: "password", value: "synthetic-only-secret" },
  ],
};
const payload = () => sanitizeEnrollment(original, locator);
const executable = "/synthetic-owned/facet-credentials";

test("local reads verify the installed helper before exactly one bounded opaque read and clear buffers", () => {
  const events: string[] = [],
    bytes = payload();
  const run: LocalCommand = (argv, input) => {
    events.push("read");
    expect(argv).toEqual([
      executable,
      "read",
      [locator.account, locator.vault, locator.item].join(":"),
    ]);
    expect(input).toBeUndefined();
    return { status: 0, stdout: bytes, stderr: Buffer.alloc(0) };
  };
  expect(
    readInstalledLocalAccount(locator, run, () => {
      events.push("verify");
      return executable;
    }).credentials.password,
  ).toBe("synthetic-only-secret");
  expect(events).toEqual(["verify", "read"]);
  expect(bytes.every((byte) => byte === 0)).toBe(true);
});

test.each([
  [10, "missing_record"],
  [11, "locked_or_interaction_required"],
  [12, "access_denied"],
  [13, "invalid_boundary"],
  [14, "keychain_failure"],
  [99, "unexpected_helper_failure"],
] as const)(
  "local failure%s is closed and never falls back",
  (status, reason) => {
    const run = vi.fn(() => ({
      status,
      stdout: Buffer.from("synthetic-only-secret"),
      stderr: Buffer.from("synthetic-only-secret"),
    }));
    expect(() =>
      readInstalledLocalAccount(locator, run, () => executable),
    ).toThrow(`local_credentials_${reason}`);
    expect(run).toHaveBeenCalledTimes(1);
  },
);

test("invalid provenance prevents any credential operation", () => {
  const run = vi.fn();
  expect(() =>
    readInstalledLocalAccount(locator, run, () => {
      throw new Error("invalid provenance");
    }),
  ).toThrow("invalid provenance");
  expect(run).not.toHaveBeenCalled();
  expect(() => installLocalHelper("wrong", helperSigning.team)).toThrow(
    "local_credentials_helper_signing_identity",
  );
  expect(signatureRequirement()).toContain(helperSigning.identity);
});

test("installation provenance rejects changed native inputs, signer, helper bytes and extra fields", () => {
  const expected = {
    schemaVersion: 1,
    kind: "facet-local-credential-helper",
    ...helperSigning,
    compilerVersion: "Apple Swift version synthetic",
    helperSHA256: "a".repeat(64),
    sourceFiles: {
      "LocalCredentialStore.swift": "b".repeat(64),
      "main.swift": "c".repeat(64),
    },
  };
  expect(() =>
    requireHelperProvenance(structuredClone(expected), expected),
  ).not.toThrow();
  for (const changed of [
    { ...expected, identity: "wrong" },
    { ...expected, helperSHA256: "d".repeat(64) },
    {
      ...expected,
      sourceFiles: { ...expected.sourceFiles, "main.swift": "e".repeat(64) },
    },
    { ...expected, team: "wrong" },
    { ...expected, extra: true },
  ])
    expect(() => requireHelperProvenance(changed, expected)).toThrow(
      "local_credentials_helper_provenance",
    );
});

test("enrollment transports bytes only through private stdin and accepts only exact fixed success", () => {
  const bytes = payload();
  const run: LocalCommand = (argv, input) => {
    expect(argv.join(" ")).not.toContain("synthetic-only-secret");
    expect(input).toBe(bytes);
    return {
      status: 0,
      stdout: Buffer.from("enrolled\n"),
      stderr: Buffer.alloc(0),
    };
  };
  expect(enrollLocalAccount(locator, bytes, run, () => executable).status).toBe(
    "enrolled-local-keychain",
  );
  expect(() =>
    enrollLocalAccount(
      locator,
      bytes,
      () => ({
        status: 0,
        stdout: Buffer.from("synthetic-only-secret"),
        stderr: Buffer.alloc(0),
      }),
      () => executable,
    ),
  ).toThrow("local_credentials_invalid_enrollment_receipt");
});

test("attended enrollment validates before one Desktop read, revalidates after approval, then clears payload", () => {
  const events: string[] = [];
  let captured: Buffer | undefined;
  const receipt = enrollFromDesktop(locator, {
    verify: () => {
      events.push("verify");
      return executable;
    },
    preflight: () => {
      events.push("target-missing");
    },
    read: () => {
      events.push("desktop-once");
      return original;
    },
    enroll: (_selected, bytes) => {
      captured = bytes;
      events.push("enroll");
      return { status: "enrolled-local-keychain", record: "synthetic" };
    },
    readback: () => {
      events.push("fresh-readback");
      return {
        credentials: {
          email: "synthetic@example.invalid",
          password: "synthetic-only-secret",
        },
        otp: undefined,
      };
    },
  });
  expect(receipt.status).toBe("enrolled-local-keychain");
  expect(events).toEqual([
    "verify",
    "target-missing",
    "desktop-once",
    "verify",
    "enroll",
    "fresh-readback",
  ]);
  expect(captured?.every((byte) => byte === 0)).toBe(true);
  const read = vi.fn();
  expect(() =>
    enrollFromDesktop(locator, {
      verify: () => {
        throw new Error("not ready");
      },
      preflight: vi.fn(),
      read,
      enroll: vi.fn(),
      readback: vi.fn(),
    }),
  ).toThrow("not ready");
  expect(read).not.toHaveBeenCalled();
  expect(() =>
    enrollFromDesktop(locator, {
      verify: () => executable,
      preflight: () => {
        throw new Error("target unavailable");
      },
      read,
      enroll: vi.fn(),
      readback: vi.fn(),
    }),
  ).toThrow("target unavailable");
  expect(read).not.toHaveBeenCalled();
});

test("only an exact missing-record preflight permits an attended source read", () => {
  expect(() =>
    assertLocalEnrollmentReady(
      locator,
      () => ({
        status: 10,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("local_credentials_missing\n"),
      }),
      () => executable,
    ),
  ).not.toThrow();
  for (const status of [0, 11, 12, 13, 14])
    expect(() =>
      assertLocalEnrollmentReady(
        locator,
        () => ({
          status,
          stdout: Buffer.from(status === 0 ? "synthetic-previous-value" : ""),
          stderr: Buffer.from("closed"),
        }),
        () => executable,
      ),
    ).toThrow();
});

test("setup CLI accepts only explicit nonsecret install/enrollment commands", () => {
  expect(
    parseLocalCredentialArguments([
      "install",
      "--identity",
      helperSigning.identity,
      "--team",
      helperSigning.team,
    ]).operation,
  ).toBe("install");
  expect(
    parseLocalCredentialArguments([
      "enroll",
      "--account",
      locator.account,
      "--vault",
      locator.vault,
      "--item",
      locator.item,
    ]).operation,
  ).toBe("enroll");
  for (const args of [
    ["read"],
    ["install"],
    ["enroll", "--password", "synthetic-only-secret"],
    ["enroll", "--account", locator.account, "--account", locator.account],
  ])
    expect(() => parseLocalCredentialArguments(args)).toThrow();
});
