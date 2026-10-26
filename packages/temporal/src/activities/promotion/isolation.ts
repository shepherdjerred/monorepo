import { providerSubprocessUid } from "#shared/agent/agent-subprocess-identity.ts";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";

export function promotionProviderUid(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  workerUid = process.getuid?.(),
): number | undefined {
  const uid = providerSubprocessUid(environment);
  if (
    parseTemporalNamespace(environment["TEMPORAL_NAMESPACE"]) !== "dev" &&
    (uid === undefined || uid === workerUid)
  )
    throw new Error(
      "Deployed promotion agents require a distinct AGENT_PROVIDER_UID",
    );
  return uid;
}
