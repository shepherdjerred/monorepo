import { timingSafeEqual } from "node:crypto";
import {
  DiscordAccountIdSchema,
  OPERATIONS_MACHINE_TOKEN_PREFIX,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";

/**
 * The machine credential for the operations API, and who it acts as.
 *
 * The token is a bootstrap secret (1Password field `SCOUT_OPERATIONS_TOKEN` on
 * each stage's Scout item, delivered as an env var and reduced to its digest at
 * boot). WHO it acts as is authorization, so it is declared here in Git beside
 * the operator allowlist and changes only by reviewed commit. A credential
 * grants nothing by itself: every request re-checks that its operator is still
 * on the allowlist and that the console flag is on for them, so dropping an
 * operator from the allowlist disables their machine credential as well.
 */
export type OperationsMachineCredential = {
  /** Recorded on every audit row this credential produces. */
  readonly label: string;
  readonly operator: DiscordAccountId;
  /** Hex SHA-256 of the token. The token itself is never held. */
  readonly tokenDigest: string;
};

const MACHINE_CREDENTIAL_BINDING = {
  label: "scout-operations-agent",
  // Jerred: agents act on his reviewed evidence, under his operator identity.
  operator: DiscordAccountIdSchema.parse("160509172704739328"),
} as const;

/** The credentials this deployment accepts; empty when none is configured. */
export function configuredOperationsMachineCredentials(): readonly OperationsMachineCredential[] {
  const tokenDigest = configuration.operationsTokenDigest;
  return tokenDigest === undefined
    ? []
    : [{ ...MACHINE_CREDENTIAL_BINDING, tokenDigest }];
}

function digestOf(token: string): Buffer {
  return Buffer.from(
    new Bun.CryptoHasher("sha256").update(token).digest("hex"),
    "hex",
  );
}

/**
 * The credential an `Authorization` header presents, or `null`.
 *
 * Compares digests in constant time and checks every configured credential
 * without stopping at a match, so neither the comparison nor the number of
 * comparisons depends on which credential, if any, the token belongs to.
 */
export function authenticateOperationsMachine(
  authorization: string | null,
  credentials: readonly OperationsMachineCredential[],
): OperationsMachineCredential | null {
  const scheme = `Bearer ${OPERATIONS_MACHINE_TOKEN_PREFIX}`;
  if (authorization?.startsWith(scheme) !== true) return null;
  const presented = digestOf(authorization.slice("Bearer ".length));
  let matched: OperationsMachineCredential | null = null;
  for (const credential of credentials) {
    const expected = Buffer.from(credential.tokenDigest, "hex");
    const equal =
      expected.length === presented.length &&
      timingSafeEqual(expected, presented);
    if (equal && matched === null) matched = credential;
  }
  return matched;
}
