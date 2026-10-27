import { describe, expect, test } from "vitest";
import { provenancePaths } from "../apple-sync-live/model";
import {
  AccountFrameDecoder,
  decodeAccountReply,
  encodeAccountCommand,
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
  stage: "credentials",
  signInEnabled: false,
};

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
      new AccountFrameDecoder(identity).push(Buffer.from(frame.repeat(14))),
    ).toThrow("frame bound");
  });
});
