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
 * Two *concrete, different* namespaces name two different objects. A live
 * object whose namespace the revision no longer renders is a prune, exactly
 * like one whose name it no longer renders: it has no target, and the rendered
 * copy in the other namespace is matched against its own live object.
 */
export function renderedTargetState(
  targets: ReadonlyMap<string, readonly RenderedTarget[]>,
  resource: ManagedResource,
  appName: string,
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
  return matches[0]?.manifest;
}
