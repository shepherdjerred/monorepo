/**
 * Auto-sync policy divergence between a rendered root revision and the cluster.
 *
 * A release suspends children by manifest override — it rewrites each rendered
 * Application with `syncPolicy.automated.enabled: false` — and there is no
 * restore step: the declared policy comes back only because later phases
 * re-apply the un-overridden manifests. An abort between those two points
 * therefore leaves the whole tree suspended, and nothing notices, because
 * suspension is a `spec` fact while every signal the release watches (Synced,
 * Healthy, operation phase) lives in `status`. That is exactly how 63 of 64
 * Applications sat frozen for ~1.5h on 2026-08-14.
 *
 * The rendered revision already encodes the intended end state for every class
 * of Application, so one rule covers all of them: an Application the revision
 * declares with an `automated` policy must carry that same policy live.
 *
 *   - repository-chart children are patched to `{enabled:false}` at render time
 *     (application-release-policy.ts), so they are declared suspended and stay
 *     that way permanently — not a release artifact;
 *   - external-source children are restored by the exact-source batch phase;
 *   - the root Application declares its own policy and is restored by the
 *     closing full-source prune sync;
 *   - an Application declaring no `automated` policy is never touched.
 */

import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";

/** Rendered in a finding when one side declares no `automated` policy at all. */
export const AUTO_SYNC_POLICY_ABSENT = "(none)";

const SyncPolicySchema = z.record(z.string(), z.unknown()).optional();

const ApplicationPolicySchema = z.object({
  metadata: z.object({ name: z.string() }),
  spec: z.object({ syncPolicy: SyncPolicySchema }).optional(),
});

const RenderedKindSchema = z.object({ kind: z.string().optional() });

// ArgoCD serves `items: null` rather than `[]` for an empty list, matching
// ApplicationListSchema in argocd-application-readiness.ts.
const LiveApplicationPolicyListSchema = z.object({
  items: z.array(ApplicationPolicySchema).nullish(),
});

/**
 * Describe an Application's `automated` policy as a comparable string.
 *
 * Scope is decided by the same predicate `prepareRootManifestOverride` uses —
 * presence of the `automated` key, not its truthiness — so the check and the
 * override can never disagree about which Applications are in scope.
 *
 * Comparison is by value rather than by bytes, since key order differs between
 * a rendered manifest and a live object and `canonicalJson` sorts keys. It is
 * deliberately exact: no defaulting of omitted booleans. ArgoCD was observed
 * echoing every declared `automated` block back verbatim, including
 * `{"enabled":false}`, so there is no known case where the two sides
 * legitimately spell the same policy differently. Defaulting `enabled` to true
 * when absent would be the one rule capable of silently accepting a suspended
 * Application, which is the entire failure this exists to catch. If ArgoCD ever
 * does start omitting a field, an exact comparison fails loudly and
 * investigably rather than passing quietly.
 */
function describeAutoSyncPolicy(
  syncPolicy: Record<string, unknown> | undefined,
): string {
  if (syncPolicy === undefined || !Object.hasOwn(syncPolicy, "automated")) {
    return AUTO_SYNC_POLICY_ABSENT;
  }
  return canonicalJson(syncPolicy["automated"]);
}

/**
 * Applications whose live auto-sync policy disagrees with the rendered
 * revision, as human-readable findings sorted by Application name.
 *
 * An Application the revision does not declare is ignored: it is a prune
 * candidate, which belongs to the release's prune phase rather than here. An
 * Application the revision declares but the cluster lacks is ignored too —
 * `releaseTreeReadiness` already reports it as missing, and duplicating that
 * would give one fault two different messages.
 */
export function autoSyncPolicyDivergences(
  renderedManifests: readonly string[],
  liveApplications: unknown,
): readonly string[] {
  const declared = new Map<string, string>();
  for (const manifestSource of renderedManifests) {
    const parsed: unknown = JSON.parse(manifestSource);
    if (RenderedKindSchema.parse(parsed).kind !== "Application") {
      continue;
    }
    // Parsed strictly, not leniently: a rendered Application that does not fit
    // this shape is a malformed root revision, not something to skip past.
    const application = ApplicationPolicySchema.parse(parsed);
    const policy = describeAutoSyncPolicy(application.spec?.syncPolicy);
    if (policy === AUTO_SYNC_POLICY_ABSENT) {
      continue;
    }
    declared.set(application.metadata.name, policy);
  }

  const live = new Map<string, string>();
  for (const application of LiveApplicationPolicyListSchema.parse(
    liveApplications,
  ).items ?? []) {
    live.set(
      application.metadata.name,
      describeAutoSyncPolicy(application.spec?.syncPolicy),
    );
  }

  const findings: string[] = [];
  for (const [name, declaredPolicy] of [...declared].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const livePolicy = live.get(name);
    if (livePolicy === undefined || livePolicy === declaredPolicy) {
      continue;
    }
    findings.push(`${name}: live ${livePolicy} declared ${declaredPolicy}`);
  }
  return findings;
}
