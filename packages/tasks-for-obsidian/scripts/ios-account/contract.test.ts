import { describe, expect, test } from "vitest";
import { z } from "zod";
import definition from "./account-input.schema.json";
import { provenancePaths } from "../apple-sync-live/model";
import {
  AccountFrameDecoder,
  decodeAccountReply,
  encodeAccountCommand,
  encodeAppCommand,
  decodeAppReply,
  assertInputClock,
  assertVerificationFresh,
  issueVerificationAfterValidation,
} from "./contract";

const identity = {
  sessionID: "12345678-1234-4234-9234-123456789abc",
  runID: "22345678-1234-4234-9234-123456789abc",
  deviceID: "32345678-1234-4234-9234-123456789abc",
};
const requestID = "42345678-1234-4234-9234-123456789abc";
const base = { schemaVersion: 1 as const, ...identity };
const ready = {
  ...base,
  kind: "ready",
  runnerPID: 123,
  operation: "auth-only",
  clockUnixMilliseconds: Date.now(),
  stage: "credentials",
  signInEnabled: false,
};

test("every closed neutral object has possible required fields and expiry belongs only to verification", () => {
  const closed = z.object({
    additionalProperties: z.literal(false),
    required: z.array(z.string()),
    properties: z.record(z.string(), z.unknown()),
  });
  function walk(value: unknown) {
    if (value === null || typeof value !== "object") return;
    const parsed = closed.safeParse(value);
    if (parsed.success)
      for (const required of parsed.data.required)
        expect(Object.hasOwn(parsed.data.properties, required)).toBe(true);
    for (const child of Object.values(value)) walk(child);
  }
  walk(definition);
  for (const [name, variants] of [
    ["command", definition.$defs.command.oneOf],
    ["app-command", definition.$defs["app-command"].oneOf],
  ] as const)
    for (const variant of variants) {
      const kind = variant.properties.kind.const;
      const required =
        name === "command"
          ? kind === "fill-verification" || kind === "submit-verification"
          : kind === "verification";
      expect(
        Object.hasOwn(variant.properties, "expiresAtUnixMilliseconds"),
      ).toBe(required);
      expect(
        new Set<string>(variant.required).has("expiresAtUnixMilliseconds"),
      ).toBe(required);
    }
});

test("code controls carry only expiry metadata and reject expired or skewed clocks", () => {
  for (const kind of ["fill-verification", "submit-verification"]) {
    expect(() => encodeAccountCommand({ ...base, requestID, kind })).toThrow();
    expect(
      encodeAccountCommand({
        ...base,
        requestID,
        kind,
        expiresAtUnixMilliseconds: Date.now() + 30_000,
      }).length,
    ).toBeGreaterThan(0);
  }
  expect(() =>
    encodeAccountCommand({
      ...base,
      requestID,
      kind: "fill",
      expiresAtUnixMilliseconds: Date.now() + 30_000,
    }),
  ).toThrow();
  expect(() => assertVerificationFresh(Date.now())).toThrow();
  expect(() => assertVerificationFresh(Date.now() + 121_000)).toThrow();
  expect(() => assertInputClock(Date.now() - 3000)).toThrow();
  expect(() => assertInputClock(Date.now(), 2001)).toThrow();
});

test("actual late writer orders full validation, eligible clock, live owners then one issue", async () => {
  const events: string[] = [];
  await issueVerificationAfterValidation(
    async () => {
      await Promise.resolve();
      events.push("validated");
    },
    {
      waitUntilFresh: async () => {
        events.push("waited");
      },
      issue: () => {
        events.push("issued");
        return {
          code: "739251",
          expiresAtUnixMilliseconds: Date.now() + 30_000,
        };
      },
    },
    async () => {
      events.push("live-owners");
    },
  );
  expect(events).toEqual(["validated", "waited", "live-owners", "issued"]);
  for (const failure of ["validation", "wait", "owners"])
    await expect(
      issueVerificationAfterValidation(
        async () => {
          if (failure === "validation") throw new Error("guard changed");
        },
        {
          waitUntilFresh: async () => {
            if (failure === "wait") throw new Error("guard changed");
          },
          issue: () => {
            events.push("forbidden");
            return {
              code: "739251",
              expiresAtUnixMilliseconds: Date.now() + 30_000,
            };
          },
        },
        async () => {
          if (failure === "owners") throw new Error("guard changed");
        },
      ),
    ).rejects.toThrow("guard changed");
  expect(events).not.toContain("forbidden");
});

describe("private iOS account boundary", () => {
  test("prepared source inventory pins credential handling, privacy proof and invoked XCTest helpers", () => {
    const scripts = "packages/tasks-for-obsidian/scripts/";
    const required = [
      "ios-account.ts",
      "ios-account/authenticate.ts",
      "ios-account/runtime.ts",
      "ios-account/connection.ts",
      "ios-account/probe.ts",
      "ios-account/leak-check.ts",
      "ios-account/account-input.schema.json",
      "native-acceptance/selected-tests.ts",
      "native-acceptance/attachments.ts",
    ];
    for (const file of required) {
      const absolute = scripts + file;
      expect(
        provenancePaths.some(
          (scope) => absolute === scope || absolute.startsWith(scope + "/"),
        ),
        file,
      ).toBe(true);
    }
  });

  test("fragmented and coalesced frames retain exact ownership and command correlation", () => {
    const filled = {
      ...base,
      kind: "filled",
      requestID,
      disabledCheckpoints: 2,
      signInEnabled: true,
      submitActionCount: 0,
    };
    const decoder = new AccountFrameDecoder(identity);
    const bytes = Buffer.from(
      JSON.stringify(ready) + "\n" + JSON.stringify(filled) + "\n",
    );
    expect(decoder.push(bytes.subarray(0, 17))).toEqual([]);
    expect(decoder.push(bytes.subarray(17))).toEqual([ready, filled]);
    expect(() =>
      decodeAccountReply(
        Buffer.from(JSON.stringify({ ...ready, runID: requestID })),
        identity,
      ),
    ).toThrow("another owned session");
  });

  test("secret fields cannot ride a nonsecret command or escape through a rejected reply", () => {
    const sentinel = "synthetic-only-credential-needle";
    expect(() =>
      encodeAccountCommand({
        ...base,
        requestID,
        kind: "fill",
        email: "example@example.invalid",
        password: sentinel + "\n",
      }),
    ).toThrow("closed contract");
    const rejected = Buffer.from(
      JSON.stringify({ ...ready, password: sentinel }),
    );
    let failure: unknown;
    try {
      decodeAccountReply(rejected, identity);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(sentinel);
    expect(() =>
      encodeAccountCommand({
        ...base,
        requestID,
        kind: "connect",
        remoteVaultID: "vault\nwrong",
      }),
    ).toThrow();
    const unsolicited = {
      ...base,
      requestID,
      kind: "observe" as const,
      email: sentinel,
    };
    expect(() => encodeAccountCommand(unsolicited)).toThrow("closed contract");
  });

  test("MFA and managed-vault readiness are explicit, and empty capabilities cannot pass", () => {
    const observed = {
      ...base,
      requestID,
      kind: "observed",
      stage: "vaults",
      busy: false,
      connectEnabled: true,
    };
    expect(
      decodeAccountReply(Buffer.from(JSON.stringify(observed)), identity),
    ).toEqual(observed);
    const { connectEnabled: _ignored, ...missing } = observed;
    expect(() =>
      decodeAccountReply(Buffer.from(JSON.stringify(missing)), identity),
    ).toThrow();
    expect(() =>
      encodeAccountCommand({
        ...base,
        requestID,
        kind: "fill-verification",
        code: "12345",
      }),
    ).toThrow();
    expect(() =>
      decodeAccountReply(
        Buffer.from(
          JSON.stringify({
            ...base,
            requestID,
            kind: "finished",
            submitActionCount: 4,
          }),
        ),
        identity,
      ),
    ).toThrow();
  });

  test("oversize, malformed and unsolicited frame floods fail closed", () => {
    expect(() =>
      new AccountFrameDecoder(identity).push(Buffer.alloc(8193, 65)),
    ).toThrow("bound");
    expect(() =>
      new AccountFrameDecoder(identity).push(Buffer.from("{broken}\n")),
    ).toThrow("invalid frame");
    const frame = JSON.stringify(ready) + "\n";
    expect(() =>
      new AccountFrameDecoder(identity).push(Buffer.from(frame.repeat(15))),
    ).toThrow("frame bound");
  });
});

test("app-only values cannot cross the Runner boundary and remain bound to an explicit stage", () => {
  const envelope = {
    ...base,
    requestID,
    formEpoch: "52345678-1234-4234-9234-123456789abc",
    token: "a".repeat(64),
    expectedStage: "credentials",
  };
  for (const [kind, value, stage] of [
    ["email", "synthetic@example.invalid", "credentials"],
    ["password", "synthetic-only-password", "credentials"],
    ["verification", "123456", "verification"],
    ["vault-password", "synthetic-vault-only", "vaults"],
  ] as const) {
    const frame = {
      ...envelope,
      kind,
      value,
      expectedStage: stage,
      ...(kind === "verification"
        ? { expiresAtUnixMilliseconds: Date.now() + 30_000 }
        : {}),
    };
    expect(encodeAppCommand(frame).toString()).toContain(value);
    expect(() => encodeAccountCommand(frame)).toThrow("closed contract");
    expect(() =>
      encodeAppCommand({
        ...frame,
        expectedStage: stage === "credentials" ? "vaults" : "credentials",
      }),
    ).toThrow("closed contract");
  }
  for (const key of ["email", "password", "code", "vaultPassword"])
    expect(() =>
      encodeAccountCommand({
        ...base,
        requestID,
        kind: "fill",
        [key]: "synthetic-only-value",
      }),
    ).toThrow("closed contract");
  expect(() => encodeAppCommand({ ...envelope, kind: "submit" })).toThrow(
    "closed contract",
  );
  expect(() =>
    encodeAppCommand({
      ...envelope,
      kind: "password",
      value: "synthetic-only-password",
      token: "short",
    }),
  ).toThrow("closed contract");
  expect(() =>
    decodeAppReply({
      ...base,
      kind: "hello",
      formEpoch: envelope.formEpoch,
      token: envelope.token,
      stage: "credentials",
      appPID: 501,
      value: "synthetic-only-secret",
    }),
  ).toThrow("closed contract");
});
