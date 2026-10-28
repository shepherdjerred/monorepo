import { spawnSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import {
  childEnvironment,
  classifyPasswordManagerFailure,
  selectCredentials,
  assertSecret,
  root,
  credentialBackend,
  type CredentialBackend,
  type PasswordManagerBackend,
} from "tasknotes-macos/scripts/mac-account-contract.ts";
import { readInstalledLocalAccount } from "tasknotes-macos/scripts/local-credentials/broker.ts";
import {
  generateTotp,
  LocalCredentialFailure,
} from "tasknotes-macos/scripts/local-credentials/payload.ts";

const ItemParametersSchema = z.strictObject({
  "--account": z.string().regex(/^[A-Za-z0-9]{20,32}$/u),
  "--vault": z.string().regex(/^[A-Za-z0-9]{20,32}$/u),
  "--item": z.string().regex(/^[A-Za-z0-9]{20,32}$/u),
});
export type HostCredentialParameters = z.infer<typeof ItemParametersSchema>;
export class PasswordManagerFailure extends Error {
  constructor(readonly classification: string) {
    super(classification);
  }
}
type SecretCommandResult = {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
  signal?: string | null;
};
export type SecretCommandRunner = (
  argv: string[],
  options: { env: Record<string, string>; timeout: number; maxBuffer: number },
) => SecretCommandResult;
const runSecretCommand: SecretCommandRunner = (argv, options) =>
  spawnSync(argv[0] ?? "", argv.slice(1), {
    ...options,
    encoding: "utf8",
  });

function failureReason(
  result: SecretCommandResult,
  backend: PasswordManagerBackend,
) {
  const code =
    result.error && "code" in result.error ? result.error.code : undefined;
  if (code === "ETIMEDOUT") return "timeout";
  if (code === "ENOENT") return "unavailable";
  const reason = classifyPasswordManagerFailure(result.stderr);
  if (backend !== "service-account") return reason;
  if (
    /service account token.*(?:required|available)|keychain token is incomplete|swift enrollment helper/iu.test(
      result.stderr,
    )
  )
    return "unavailable";
  return reason === "permission" ||
    (reason === "unknown" && result.status === 6)
    ? "denied"
    : reason;
}

function captureSecret(
  args: string[],
  timeout: number,
  backend: PasswordManagerBackend,
  run: SecretCommandRunner,
): string {
  const argv =
    backend === "service-account"
      ? [
          path.join(root, "scripts/onepassword/with-service-account.sh"),
          "/opt/homebrew/bin/op",
          ...args,
        ]
      : ["/opt/homebrew/bin/op", ...args];
  const environment = childEnvironment(Bun.env);
  // Only the short-lived service-account reader receives the configured token.
  // Native apps, transport children and explicit Desktop reads retain the strict allowlist.
  if (
    backend === "service-account" &&
    Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] !== undefined
  )
    environment["OP_SERVICE_ACCOUNT_TOKEN"] =
      Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  const result = run(argv, {
    env: environment,
    timeout,
    maxBuffer: 1_048_576,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new PasswordManagerFailure(
      `password_manager_${backend.replaceAll("-", "_")}_${failureReason(result, backend)}`,
    );
  }
  return result.stdout;
}
/** Host memory only. Callers must prove and then revalidate their exact owned native form. */
export function readHostCredentialItem(
  parameters: HostCredentialParameters,
  selectedBackend: CredentialBackend = "keychain",
  run: SecretCommandRunner = runSecretCommand,
  readLocal: typeof readInstalledLocalAccount = readInstalledLocalAccount,
) {
  const backend = credentialBackend(selectedBackend);
  const selected = ItemParametersSchema.parse(parameters);
  if (backend === "keychain") {
    try {
      return readLocal({
        account: selected["--account"],
        vault: selected["--vault"],
        item: selected["--item"],
      }).credentials;
    } catch (error) {
      throw new PasswordManagerFailure(
        error instanceof LocalCredentialFailure
          ? error.classification
          : "local_credentials_unavailable",
      );
    }
  }
  const output = captureSecret(
    [
      "item",
      "get",
      selected["--item"],
      "--vault",
      selected["--vault"],
      ...(backend === "desktop" ? ["--account", selected["--account"]] : []),
      "--format",
      "json",
      "--reveal",
    ],
    60_000,
    backend,
    run,
  );
  try {
    return selectCredentials(
      JSON.parse(output),
      selected["--item"],
      selected["--vault"],
    );
  } catch {
    throw new PasswordManagerFailure("password_manager_invalid_item");
  }
}
export function readHostVerificationCode(
  parameters: HostCredentialParameters,
  selectedBackend: CredentialBackend = "keychain",
  run: SecretCommandRunner = runSecretCommand,
  readLocal: typeof readInstalledLocalAccount = readInstalledLocalAccount,
): string {
  const backend = credentialBackend(selectedBackend);
  const selected = ItemParametersSchema.parse(parameters);
  if (backend === "keychain") {
    try {
      const { otp } = readLocal({
        account: selected["--account"],
        vault: selected["--vault"],
        item: selected["--item"],
      });
      if (otp === undefined)
        throw new LocalCredentialFailure("local_credentials_missing_otp");
      return generateTotp(
        otp.secret,
        Math.floor(Date.now() / 1000),
        otp.algorithm,
        6,
        otp.period,
      );
    } catch (error) {
      throw new PasswordManagerFailure(
        error instanceof LocalCredentialFailure
          ? error.classification
          : "local_credentials_unavailable",
      );
    }
  }
  const code = captureSecret(
    [
      "item",
      "get",
      selected["--item"],
      "--vault",
      selected["--vault"],
      ...(backend === "desktop" ? ["--account", selected["--account"]] : []),
      "--otp",
    ],
    60_000,
    backend,
    run,
  ).trim();
  try {
    assertSecret(code, 6);
    return z
      .string()
      .regex(/^\d{6}$/u)
      .parse(code);
  } catch {
    throw new PasswordManagerFailure("password_manager_invalid_otp");
  }
}
/** Choose Desktop explicitly for a Personal item; no backend fallback or credential copying. */
export function readHostVaultPassword(
  reference: string,
  backend: "service-account" | "desktop" = "service-account",
  run: SecretCommandRunner = runSecretCommand,
): string {
  z.string()
    .regex(/^op:\/\/[A-Za-z0-9]{20,32}\/[A-Za-z0-9]{20,32}\/password$/u)
    .parse(reference);
  z.enum(["service-account", "desktop"]).parse(backend);
  const password = captureSecret(
    ["read", reference],
    30_000,
    backend,
    run,
  ).replace(/\n$/u, "");
  try {
    assertSecret(password, 512);
    return password;
  } catch {
    throw new PasswordManagerFailure("password_manager_invalid_vault_password");
  }
}

/** Explicit enrollment source only. The unchanged original item is read once. */
export function readDesktopEnrollmentItem(
  parameters: HostCredentialParameters,
  run: SecretCommandRunner = runSecretCommand,
): unknown {
  const selected = ItemParametersSchema.parse(parameters);
  const output = captureSecret(
    [
      "item",
      "get",
      selected["--item"],
      "--vault",
      selected["--vault"],
      "--account",
      selected["--account"],
      "--format",
      "json",
      "--reveal",
    ],
    60_000,
    "desktop",
    run,
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new PasswordManagerFailure("password_manager_invalid_item");
  }
}
