import { describe, expect, test, vi } from "vitest";
import {
  readHostCredentialItem,
  readHostVaultPassword,
  readHostVerificationCode,
  type SecretCommandRunner,
} from "./credential-host";
import { parseOfficialAccountArguments } from "./official-host";
import {
  parseArguments,
  root,
} from "tasknotes-macos/scripts/mac-account-contract";
import { parseIosCredentialOptions } from "../../../ios-account";
import path from "node:path";

const locators = {
  "--account": "A".repeat(26),
  "--vault": "b".repeat(26),
  "--item": "c".repeat(26),
};
const reference = `op://${locators["--vault"]}/${locators["--item"]}/password`;
const locatorArgs = Object.entries(locators).flat();
const runID = "12345678-1234-4234-9234-123456789abc";
const item = JSON.stringify({
  id: locators["--item"],
  vault: { id: locators["--vault"] },
  fields: [
    { id: "username", value: "synthetic@example.invalid" },
    { id: "password", value: "synthetic-only-password" },
  ],
});
const malformed: SecretCommandRunner = () => ({
  stdout: "synthetic-only-secret",
  stderr: "",
  status: 0,
});
const empty: SecretCommandRunner = () => ({
  stdout: "",
  stderr: "",
  status: 0,
});

describe("prompt-free Apple acceptance credential routing", () => {
  test.each([undefined, "service-account", "desktop"] as const)(
    "all secret operations use only the selected backend (%s)",
    (backend) => {
      const calls: string[][] = [];
      vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "synthetic-service-token");
      vi.stubEnv("OP_SESSION_example", "synthetic-session");
      const fake: SecretCommandRunner = (argv, options) => {
        calls.push(argv);
        if (backend === "desktop")
          expect(options.env).not.toHaveProperty("OP_SERVICE_ACCOUNT_TOKEN");
        else
          expect(options.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBe(
            "synthetic-service-token",
          );
        expect(options.env).not.toHaveProperty("OP_SESSION_example");
        expect(options.timeout).toBeGreaterThan(0);
        expect(options.maxBuffer).toBe(1_048_576);
        return {
          stdout: argv.includes("--otp")
            ? "123456\n"
            : argv.includes("read")
              ? "synthetic-vault-password\n"
              : item,
          stderr: "",
          status: 0,
        };
      };
      const logging = vi.spyOn(console, "log");
      try {
        expect(readHostCredentialItem(locators, backend, fake)).toEqual({
          email: "synthetic@example.invalid",
          password: "synthetic-only-password",
        });
        expect(readHostVerificationCode(locators, backend, fake)).toBe(
          "123456",
        );
        expect(readHostVaultPassword(reference, backend, fake)).toBe(
          "synthetic-vault-password",
        );
        expect(logging).not.toHaveBeenCalled();
      } finally {
        logging.mockRestore();
        vi.unstubAllEnvs();
      }
      expect(calls).toHaveLength(3);
      for (const argv of calls) {
        if (backend === "desktop") expect(argv[0]).toBe("/opt/homebrew/bin/op");
        else {
          expect(argv.slice(0, 2)).toEqual([
            path.join(root, "scripts/onepassword/with-service-account.sh"),
            "/opt/homebrew/bin/op",
          ]);
          expect(argv).not.toContain("--account");
          expect(argv).not.toContain(locators["--account"]);
        }
        expect(argv.join(" ")).not.toContain("synthetic-only-password");
        expect(argv.join(" ")).not.toContain("synthetic-vault-password");
      }
      if (backend === "desktop") {
        expect(calls[0]).toContain("--account");
        expect(calls[0]).toContain(locators["--account"]);
        expect(calls[1]).toContain("--account");
        expect(calls[2]).not.toContain("--account");
      }
    },
  );

  test.each([
    [
      "No homelab 1Password service account token is available in Keychain. synthetic-only-secret",
      1,
      "unavailable",
    ],
    ["permission denied synthetic-only-secret", 6, "denied"],
    ["item not found synthetic-only-secret", 1, "not_found"],
    ["item not found synthetic-only-secret", 6, "not_found"],
    ["connection refused synthetic-only-secret", 1, "network"],
  ] as const)(
    "service-account provisioning failures are closed and never fall back (%s)",
    (stderr, status, reason) => {
      const commands: string[][] = [];
      const fake: SecretCommandRunner = (argv) => {
        commands.push(argv);
        return { stdout: "synthetic-only-secret", stderr, status };
      };
      expect(() => readHostCredentialItem(locators, undefined, fake)).toThrow(
        `password_manager_service_account_${reason}`,
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]?.[0]).toBe(
        path.join(root, "scripts/onepassword/with-service-account.sh"),
      );
    },
  );

  test("timeouts and invalid secret payloads never surface their values", () => {
    const timeout = Object.assign(new Error("synthetic-only-secret"), {
      code: "ETIMEDOUT",
    });
    const timedOut: SecretCommandRunner = () => ({
      stdout: "",
      stderr: "synthetic-only-secret",
      status: null,
      error: timeout,
    });
    expect(() => readHostCredentialItem(locators, undefined, timedOut)).toThrow(
      "password_manager_service_account_timeout",
    );
    expect(() =>
      readHostCredentialItem(locators, undefined, malformed),
    ).toThrow("password_manager_invalid_item");
    expect(() =>
      readHostVerificationCode(locators, undefined, malformed),
    ).toThrow("password_manager_invalid_otp");
    expect(() => readHostVaultPassword(reference, undefined, empty)).toThrow(
      "password_manager_invalid_vault_password",
    );
  });
});

test("all Apple command parsers default to service-account and require explicit Desktop opt-in", () => {
  for (const backend of [undefined, "desktop"] as const) {
    const flag = backend === undefined ? [] : ["--credential-backend", backend];
    const expected = backend ?? "service-account";
    expect(
      parseOfficialAccountArguments([
        runID,
        "credentials",
        ...locatorArgs,
        ...flag,
      ]).credentialBackend,
    ).toBe(expected);
    expect(
      parseArguments([runID, "credentials", ...locatorArgs, ...flag])
        .parameters["--credential-backend"],
    ).toBe(expected);
    expect(
      parseArguments([runID, "verification", ...locatorArgs, ...flag])
        .parameters["--credential-backend"],
    ).toBe(expected);
    expect(
      parseIosCredentialOptions([
        ...locatorArgs,
        "--vault-password-ref",
        reference,
        ...flag,
      ]).credentialBackend,
    ).toBe(expected);
    const vaultFlag =
      backend === undefined ? [] : ["--vault-password-backend", backend];
    expect(
      parseArguments([
        runID,
        "vault",
        "--vault-password-ref",
        reference,
        ...vaultFlag,
      ]).parameters["--vault-password-backend"],
    ).toBe(expected);
    expect(
      parseIosCredentialOptions([
        ...locatorArgs,
        "--vault-password-ref",
        reference,
        ...vaultFlag,
      ]).vaultPasswordBackend,
    ).toBe(expected);
  }
  expect(() =>
    parseOfficialAccountArguments([
      runID,
      "credentials",
      ...locatorArgs,
      "--credential-backend",
      "automatic",
    ]),
  ).toThrow();
  expect(() =>
    parseArguments([runID, "present", "--credential-backend", "desktop"]),
  ).toThrow();
  expect(() =>
    parseArguments([
      runID,
      "vault",
      "--vault-password-ref",
      reference,
      "--credential-backend",
      "desktop",
    ]),
  ).toThrow();
  expect(() =>
    parseIosCredentialOptions([
      ...locatorArgs,
      "--vault-password-ref",
      reference,
      "--credential-backend",
      "automatic",
    ]),
  ).toThrow();
});
