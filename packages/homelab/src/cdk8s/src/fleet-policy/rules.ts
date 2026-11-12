import {
  selectorMatches,
  type Fleet,
  type FleetContainer,
  type FleetWorkload,
  type PolicyType,
} from "./fleet.ts";

/**
 * The fleet rules, each returning the allowlist keys that break it today.
 * Kept apart from the tests so a rule reads as one definition.
 */

/**
 * Workloads no NetworkPolicy of the given type selects, as `<namespace>/<name>`.
 * A pod no policy selects accepts (Ingress) or opens (Egress) every
 * connection. Host-network pods are skipped: NetworkPolicy does not apply to
 * them.
 */
export function workloadsWithoutPolicy(
  fleet: Fleet,
  type: PolicyType,
): string[] {
  return fleet.workloads
    .filter((workload) => !workload.hostNetwork)
    .filter(
      (workload) =>
        !fleet.networkPolicies.some(
          (policy) =>
            policy.namespace === workload.namespace &&
            policy.policyTypes.includes(type) &&
            selectorMatches(policy.podSelector, workload.podLabels),
        ),
    )
    .map((workload) => workload.key);
}

/**
 * Argo Application destination namespaces whose pods come from an upstream
 * chart (no workload is synthesized here) and that this repository gives no
 * NetworkPolicy of the given type. Their pod labels are not visible to
 * synthesis, so the rule is per namespace.
 */
export function upstreamNamespacesWithoutPolicy(
  fleet: Fleet,
  type: PolicyType,
): string[] {
  const synthesized = new Set(
    fleet.workloads.map((workload) => workload.namespace),
  );
  return [...fleet.applicationNamespaces]
    .filter((namespace) => !synthesized.has(namespace))
    .filter(
      (namespace) =>
        !fleet.networkPolicies.some(
          (policy) =>
            policy.namespace === namespace && policy.policyTypes.includes(type),
        ),
    );
}

function hasReadinessGate(container: FleetContainer): boolean {
  return (
    container.spec.readinessProbe !== undefined ||
    container.spec.startupProbe !== undefined
  );
}

function servingContainers(workload: FleetWorkload): FleetContainer[] {
  return workload.containers.filter((container) => !container.runsToCompletion);
}

/**
 * Long-running containers that declare a port but have neither a readiness
 * nor a startup probe, as `<namespace>/<workload>/<container>`. Without one
 * the kubelet reports the container ready the moment its process starts.
 */
export function portContainersWithoutProbe(fleet: Fleet): string[] {
  return fleet.workloads
    .flatMap((workload) => servingContainers(workload))
    .filter(
      (container) =>
        (container.spec.ports ?? []).length > 0 && !hasReadinessGate(container),
    )
    .map((container) => container.key);
}

/**
 * Workloads a Service routes to in which no container has a readiness or
 * startup probe, as `<namespace>/<name>`. Catches the serving pods whose
 * containers declare no port.
 */
export function servedWorkloadsWithoutProbe(fleet: Fleet): string[] {
  return fleet.workloads
    .filter((workload) =>
      fleet.serviceSelectors.some(
        (service) =>
          service.namespace === workload.namespace &&
          selectorMatches(
            { matchLabels: service.selector },
            workload.podLabels,
          ),
      ),
    )
    .filter(
      (workload) =>
        !servingContainers(workload).some((container) =>
          hasReadinessGate(container),
        ),
    )
    .map((workload) => workload.key);
}

function allContainers(
  fleet: Fleet,
): { workload: FleetWorkload; container: FleetContainer }[] {
  return fleet.workloads.flatMap((workload) =>
    workload.containers.map((container) => ({ workload, container })),
  );
}

/** Containers that do not set `allowPrivilegeEscalation: false`. */
export function containersAllowingPrivilegeEscalation(fleet: Fleet): string[] {
  return allContainers(fleet)
    .filter(
      ({ container }) =>
        container.spec.securityContext?.allowPrivilegeEscalation !== false,
    )
    .map(({ container }) => container.key);
}

/** Containers with no seccomp profile of their own or from their pod. */
export function containersWithoutSeccomp(fleet: Fleet): string[] {
  return allContainers(fleet)
    .filter(
      ({ workload, container }) =>
        (container.spec.securityContext?.seccompProfile?.type ??
          workload.podSeccomp) === undefined,
    )
    .map(({ container }) => container.key);
}
