import {
  readDesktopEnrollmentItem,
  type HostCredentialParameters,
} from "../../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/credential-host.ts";
import {
  assertLocalEnrollmentReady,
  enrollLocalAccount,
  readInstalledLocalAccount,
} from "./broker.ts";
import { isDeepStrictEqual } from "node:util";
import { verifyInstalledHelper } from "./helper.ts";
import {
  recordKey,
  sanitizeEnrollment,
  parseLocalAccount,
  LocalCredentialFailure,
  type CredentialLocator,
} from "./payload.ts";

/** Setup is explicit and attended; routine reads never invoke this path. */
export function enrollFromDesktop(
  locator: CredentialLocator,
  dependencies = {
    verify: verifyInstalledHelper,
    preflight: assertLocalEnrollmentReady,
    read: readDesktopEnrollmentItem,
    enroll: enrollLocalAccount,
    readback: readInstalledLocalAccount,
  },
) {
  recordKey(locator);
  // Build/sign/provenance must be ready before the single Desktop source read.
  const before = dependencies.verify();
  dependencies.preflight(locator);
  const parameters: HostCredentialParameters = {
    "--account": locator.account,
    "--vault": locator.vault,
    "--item": locator.item,
  };
  const original = dependencies.read(parameters);
  const payload = sanitizeEnrollment(original, locator);
  try {
    if (dependencies.verify() !== before)
      throw new Error(
        "Local credential helper changed during enrollment approval",
      );
    const receipt = dependencies.enroll(locator, payload);
    // This is a fresh helper process, proving future reads satisfy its ACL without UI.
    if (
      !isDeepStrictEqual(
        dependencies.readback(locator),
        parseLocalAccount(payload, locator),
      )
    )
      throw new LocalCredentialFailure("local_credentials_readback_mismatch");
    return { ...receipt, verifiedReadback: true };
  } finally {
    payload.fill(0);
  }
}
