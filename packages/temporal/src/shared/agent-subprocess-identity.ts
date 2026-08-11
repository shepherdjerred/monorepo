import { z } from "zod/v4";

const ProviderUidSchema = z.coerce.number().int().positive();

/**
 * Return the dedicated uid used for provider-controlled subprocesses.
 *
 * Local development intentionally omits AGENT_PROVIDER_UID and keeps the
 * caller's uid. Production sets it to a different uid from the Temporal
 * poller so the pod-local owner firewall can deny provider traffic to the
 * Temporal frontend without interrupting worker polling.
 */
export function providerSubprocessUid(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): number | undefined {
  const configured = environment["AGENT_PROVIDER_UID"];
  return configured === undefined
    ? undefined
    : ProviderUidSchema.parse(configured);
}

export function providerSubprocessCommand(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string[] {
  const uid = providerSubprocessUid(environment);
  return uid === undefined
    ? [...command]
    : ["setpriv", `--reuid=${uid.toString()}`, "--", ...command];
}
