import type { ManagedResource } from "./argocd-apply-safety.ts";

export type RenderedTarget = {
  readonly apiVersion: string;
  readonly group: string;
  readonly kind: string;
  readonly manifest: string;
  readonly name: string;
  readonly namespace: string | undefined;
};

export function resourceIdentity(
  group: string,
  kind: string,
  name: string,
): string {
  return JSON.stringify([group, kind, name]);
}

/**
 * Either side may omit the namespace for the same object: a rendered manifest
 * leaves it to the Application's destination, and `managed-resources` omits it
 * for a cluster-scoped resource whose chart still stamps `metadata.namespace`
 * (harmless — the API server ignores it). So a missing namespace on either side
 * is a wildcard, and more than one wildcard match is ambiguous and fatal.
 *
 * Two *concrete, different* namespaces name two different objects. When every
 * namespace the revision renders the object in already has its own live copy,
 * the unmatched live object is a plain prune and has no target. When a rendered
 * namespace has no live copy, the object is moving namespace; that stays fatal,
 * because a missing target would skip the immutable checks for it entirely.
 */
export function renderedTargetState(
  targets: ReadonlyMap<string, readonly RenderedTarget[]>,
  resource: ManagedResource,
  appName: string,
  live: readonly ManagedResource[],
): string | undefined {
  const identity = resourceIdentity(
    resource.group ?? "",
    resource.kind,
    resource.name,
  );
  const candidates = targets.get(identity) ?? [];
  const matches = candidates.filter(
    ({ namespace }) =>
      namespace === undefined ||
      resource.namespace === undefined ||
      namespace === resource.namespace,
  );
  if (matches.length > 1) {
    throw new Error(
      `Apply-safety preflight for ${appName} matched ${identity} to ${matches.length.toString()} rendered manifests`,
    );
  }
  if (matches.length === 0) {
    const moved = candidates.filter(
      (candidate) =>
        !live.some(
          (other) =>
            resourceIdentity(other.group ?? "", other.kind, other.name) ===
              identity && other.namespace === candidate.namespace,
        ),
    );
    if (moved.length > 0) {
      const rendered = moved
        .map(({ namespace = "<none>" }) => namespace)
        .join(", ");
      throw new Error(
        `Apply-safety preflight for ${appName} found ${identity} in namespace ${resource.namespace ?? "<none>"} but rendered it in ${rendered}`,
      );
    }
  }
  return matches[0]?.manifest;
}
