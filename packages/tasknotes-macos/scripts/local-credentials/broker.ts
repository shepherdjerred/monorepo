import { spawnSync } from "node:child_process";
import { childEnvironment } from "../mac-account-contract.ts";
import { verifyInstalledHelper } from "./helper.ts";
import {
  LocalCredentialFailure,
  maximumCredentialBytes,
  parseLocalAccount,
  recordKey,
  type CredentialLocator,
} from "./payload.ts";

type Result = {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
  signal?: string | null;
};
export type LocalCommand = (argv: string[], input?: Buffer) => Result;
const runLocal: LocalCommand = (argv, input) =>
  spawnSync(argv[0] ?? "", argv.slice(1), {
    env: childEnvironment(process.env),
    timeout: 10_000,
    maxBuffer: maximumCredentialBytes,
    ...(input === undefined ? {} : { input }),
  });
function classify(result: Result) {
  if (result.error || result.signal) return "tooling_or_timeout";
  return (
    new Map([
      [10, "missing_record"],
      [11, "locked_or_interaction_required"],
      [12, "access_denied"],
      [13, "invalid_boundary"],
      [14, "keychain_failure"],
    ]).get(result.status ?? -1) ?? "unexpected_helper_failure"
  );
}
/** Setup may read Desktop only when the fixed local target is absent and usable. */
export function assertLocalEnrollmentReady(
  locator: CredentialLocator,
  run: LocalCommand = runLocal,
  verify: () => string = verifyInstalledHelper,
) {
  const result = run([verify(), "read", recordKey(locator)]);
  try {
    if (
      result.status === 10 &&
      !result.error &&
      !result.signal &&
      result.stdout.length === 0 &&
      result.stderr.toString("utf8") === "local_credentials_missing\n"
    )
      return;
    throw new LocalCredentialFailure(
      result.status === 0
        ? "local_credentials_already_enrolled"
        : `local_credentials_${classify(result)}`,
    );
  } finally {
    result.stdout.fill(0);
    result.stderr.fill(0);
  }
}
export function readInstalledLocalAccount(
  locator: CredentialLocator,
  run: LocalCommand = runLocal,
  verify: () => string = verifyInstalledHelper,
) {
  const record = recordKey(locator),
    executable = verify();
  const result = run([executable, "read", record]);
  try {
    if (
      result.status !== 0 ||
      result.error ||
      result.signal ||
      result.stderr.length !== 0
    )
      throw new LocalCredentialFailure(`local_credentials_${classify(result)}`);
    return parseLocalAccount(result.stdout, locator);
  } finally {
    result.stdout.fill(0);
    result.stderr.fill(0);
  }
}
/** Called only by explicit enrollment, after one attended Desktop source read. */
export function enrollLocalAccount(
  locator: CredentialLocator,
  payload: Buffer,
  run: LocalCommand = runLocal,
  verify: () => string = verifyInstalledHelper,
) {
  const record = recordKey(locator);
  if (payload.length === 0 || payload.length > maximumCredentialBytes)
    throw new LocalCredentialFailure("local_credentials_invalid_payload");
  parseLocalAccount(payload, locator);
  const executable = verify();
  const result = run([executable, "enroll", record], payload);
  try {
    if (
      result.status !== 0 ||
      result.error ||
      result.signal ||
      result.stderr.length !== 0
    )
      throw new LocalCredentialFailure(`local_credentials_${classify(result)}`);
    if (result.stdout.toString("utf8").trim() !== "enrolled")
      throw new LocalCredentialFailure(
        "local_credentials_invalid_enrollment_receipt",
      );
    return { status: "enrolled-local-keychain", record };
  } finally {
    result.stdout.fill(0);
    result.stderr.fill(0);
  }
}
