import {
  resolveCredentials,
  TEMPORAL_IN_CLUSTER_ADDRESS,
} from "@shepherdjerred/toolkit/lib/credentials.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type ResolveCredentials = (names: readonly string[]) => Promise<void>;

/**
 * Whether an operator command must broker `TEMPORAL_API_KEY` before it runs.
 *
 * Only an external TLS endpoint needs the key. An explicit nonempty value
 * wins, the in-cluster service never needs it, and a plaintext connection is
 * left alone so `temporalConnectionOptions` keeps rejecting a key without TLS.
 */
export function temporalApiKeyNeedsResolution(
  environment: Environment,
): boolean {
  const apiKey = environment["TEMPORAL_API_KEY"];
  const hasApiKey = apiKey !== undefined && apiKey.length > 0;
  return (
    !hasApiKey &&
    environment["TEMPORAL_ADDRESS"] !== TEMPORAL_IN_CLUSTER_ADDRESS &&
    environment["TEMPORAL_TLS"] === "true"
  );
}

/**
 * Resolve `TEMPORAL_API_KEY` once into `Bun.env` through toolkit's credential
 * broker, which reads the Keychain-enrolled 1Password service account instead
 * of waiting for 1Password desktop approval. Replay and canary subprocesses
 * inherit `Bun.env`, so they receive the key without resolving it again.
 *
 * The broker exports the service account token for its own `op read`. Remove
 * it again unless the operator supplied it, so candidate code and other
 * children receive only the Temporal key, never vault access.
 */
export async function resolveOperatorTemporalApiKey(
  resolve: ResolveCredentials = resolveCredentials,
): Promise<void> {
  if (!temporalApiKeyNeedsResolution(Bun.env)) {
    return;
  }
  const ambientServiceAccount = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  try {
    await resolve(["TEMPORAL_API_KEY"]);
  } finally {
    if (ambientServiceAccount === undefined) {
      Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
    }
  }
}
