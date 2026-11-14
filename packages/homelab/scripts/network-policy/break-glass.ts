/**
 * The break-glass NetworkPolicy, `enforcement-break-glass-<namespace>`: an
 * allow-all policy an operator applies by hand to open a namespace at once.
 *
 * It is a separate object, not an edit of the staging policy, because ArgoCD
 * self-heals the staging policy back to source within minutes. ArgoCD acts
 * only on resources it tracks (the `argocd.argoproj.io/tracking-id`
 * annotation, or the `argocd.argoproj.io/instance` label), no AppProject
 * monitors orphaned resources, and prune removes only tracked resources that
 * left git. An object carrying neither marker therefore stays until an
 * operator closes it.
 */
import {
  allowsEverythingForEveryPod,
  NamespaceNameSchema,
  stageLabel,
  type NetworkPolicy,
  type Stage,
} from "./staging-policy.ts";

const BREAK_GLASS_PREFIX = "enforcement-break-glass-";
export const BREAK_GLASS_LABEL = "homelab.sjer.red/break-glass";
export const BREAK_GLASS_FIELD_MANAGER = "network-policy-break-glass";
const REASON_ANNOTATION = "homelab.sjer.red/break-glass-reason";
const OPERATOR_ANNOTATION = "homelab.sjer.red/break-glass-operator";
const AT_ANNOTATION = "homelab.sjer.red/break-glass-at";

export function breakGlassPolicyName(namespace: string): string {
  return `${BREAK_GLASS_PREFIX}${NamespaceNameSchema.parse(namespace)}`;
}

function hasBreakGlassName(policy: NetworkPolicy): boolean {
  return (
    policy.metadata.name === `${BREAK_GLASS_PREFIX}${policy.metadata.namespace}`
  );
}

function hasBreakGlassLabel(policy: NetworkPolicy): boolean {
  return policy.metadata.labels?.[BREAK_GLASS_LABEL] === "true";
}

/** The label AND the name for its own namespace: the only object ever deleted. */
export function isBreakGlassPolicy(policy: NetworkPolicy): boolean {
  return hasBreakGlassName(policy) && hasBreakGlassLabel(policy);
}

/**
 * Everything in a namespace that claims to be a break-glass policy, by label
 * or by name, so a half-matching object is reported rather than overlooked.
 */
export function breakGlassCandidates(
  policies: readonly NetworkPolicy[],
  namespace: string,
): NetworkPolicy[] {
  return policies.filter(
    (policy) =>
      policy.metadata.namespace === namespace &&
      (hasBreakGlassName(policy) || hasBreakGlassLabel(policy)),
  );
}

/** Why a candidate is not deletable, or undefined when it is. */
export function refusalOf(policy: NetworkPolicy): string | undefined {
  if (isBreakGlassPolicy(policy)) {
    return undefined;
  }
  return hasBreakGlassLabel(policy)
    ? `carries the break-glass label but is not named ${BREAK_GLASS_PREFIX}${policy.metadata.namespace}`
    : `has the break-glass name but not the label ${BREAK_GLASS_LABEL}=true`;
}

/**
 * - `none`: no candidate.
 * - `open`: the break-glass policy exists and allows everything for every pod.
 * - `unrecognized`: a candidate exists but none is that policy.
 */
export type BreakGlassState = "none" | "open" | "unrecognized";

export function breakGlassState(
  policies: readonly NetworkPolicy[],
  namespace: string,
): BreakGlassState {
  const candidates = breakGlassCandidates(policies, namespace);
  if (candidates.length === 0) {
    return "none";
  }
  return candidates.some(
    (policy) =>
      isBreakGlassPolicy(policy) && allowsEverythingForEveryPod(policy),
  )
    ? "open"
    : "unrecognized";
}

/** Every namespace with a break-glass candidate, sorted. */
export function breakGlassNamespaces(
  policies: readonly NetworkPolicy[],
): string[] {
  return [
    ...new Set(
      policies
        .filter(
          (policy) => hasBreakGlassName(policy) || hasBreakGlassLabel(policy),
        )
        .map((policy) => policy.metadata.namespace),
    ),
  ].toSorted();
}

/** What governs the namespace: a break-glass policy overrides the stage. */
export function effectiveStageLabel(
  stage: Stage,
  breakGlass: BreakGlassState,
): string {
  if (breakGlass === "open") {
    return "open (break-glass)";
  }
  return breakGlass === "unrecognized"
    ? `${stageLabel(stage)} (unrecognized break-glass)`
    : stageLabel(stage);
}

export type BreakGlassManifest = {
  apiVersion: "networking.k8s.io/v1";
  kind: "NetworkPolicy";
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
  };
  spec: {
    podSelector: Record<string, never>;
    policyTypes: ["Ingress", "Egress"];
    ingress: [Record<string, never>];
    egress: [Record<string, never>];
  };
};

export type BreakGlassRecord = {
  reason: string;
  /** Who applied it: the kubectl context. */
  operator: string;
  at: Date;
};

/**
 * The allow-all policy that opens a namespace. It carries no ArgoCD tracking
 * label or annotation, so no Application owns, reverts or prunes it.
 */
export function breakGlassManifest(
  namespace: string,
  record: BreakGlassRecord,
): BreakGlassManifest {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: breakGlassPolicyName(namespace),
      namespace,
      labels: { [BREAK_GLASS_LABEL]: "true" },
      annotations: {
        [REASON_ANNOTATION]: record.reason,
        [OPERATOR_ANNOTATION]: record.operator,
        // RFC 3339, UTC.
        [AT_ANNOTATION]: record.at.toISOString(),
      },
    },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [{}],
      egress: [{}],
    },
  };
}
