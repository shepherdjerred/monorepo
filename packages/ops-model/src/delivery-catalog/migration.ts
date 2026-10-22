import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";

/**
 * v1 environment ids the catalog renames at the cutover (Delivery model,
 * section 7): the shared `static-sites` service splits into one service per
 * site plus the proxy, redlib leaves `self-hosted-apps`, and each OpenTofu
 * stack becomes its own `tofu-<stack>` service. Environment ownership is
 * immutable in Delivery, so the window's migration carries each accepted
 * selection from the old id to the new one; the target instance (bucket,
 * Application, state key) is the same. Every other v1 environment keeps its
 * id. `gitops/root` has no successor: the root release is retired (X6).
 */
export const V1_ENVIRONMENT_RENAMES: Readonly<Record<string, string>> = {
  "static-sites/proxy": "static-site-proxy/prod",
  "self-hosted-apps/redlib": "redlib/prod",
  ...Object.fromEntries(
    Object.entries(STATIC_SITE_DESTINATIONS)
      .filter(([, environment]) => environment.startsWith("static-sites/"))
      .map(([bucket, environment]) => [environment, `${bucket}/prod`]),
  ),
  ...Object.fromEntries(
    TofuStackSchema.options
      .filter((stack) => stack !== "application-secrets")
      .map((stack) => [`gitops/tofu:${stack}`, `tofu-${stack}/prod`]),
  ),
};

/** v1 environments with no successor. */
export const V1_RETIRED_ENVIRONMENTS: readonly string[] = ["gitops/root"];

/** The catalog environment a v1 environment id becomes; unknown retired ids fail. */
export function catalogEnvironmentOf(v1EnvironmentId: string): string {
  if (V1_RETIRED_ENVIRONMENTS.includes(v1EnvironmentId))
    throw new Error(`v1 environment ${v1EnvironmentId} has no successor`);
  return V1_ENVIRONMENT_RENAMES[v1EnvironmentId] ?? v1EnvironmentId;
}
