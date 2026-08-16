import { z } from "zod";
import { parseObject, type ManagedResource } from "./argocd-apply-safety.ts";

const JsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * Only the parts of an Application this file reasons about. A loose object keeps
 * the rest of the object out of the way rather than admitting unknown keys into
 * the decision.
 */
const IgnoreDifferenceSchema = z
  .object({
    group: z.string().optional(),
    kind: z.string(),
    name: z.string().optional(),
    namespace: z.string().optional(),
    jsonPointers: z.array(z.string()).optional(),
  })
  .loose();

const ApplicationIgnoreRulesSchema = z
  .object({
    spec: z
      .object({
        ignoreDifferences: z.array(IgnoreDifferenceSchema).optional(),
        syncPolicy: z
          .object({ syncOptions: z.array(z.string()).optional() })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const RESPECT_IGNORE_DIFFERENCES = "RespectIgnoreDifferences=true";

/**
 * RFC 6901: `~1` is a literal `/` and `~0` a literal `~`, and the pointer's
 * leading empty segment addresses the document root. A pointer that is not
 * rooted is not a pointer, and returning no path leaves the field compared.
 */
function pointerSegments(pointer: string): readonly string[] | undefined {
  if (!pointer.startsWith("/")) {
    return undefined;
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function ignoreRuleMatches(
  rule: z.infer<typeof IgnoreDifferenceSchema>,
  resource: ManagedResource,
): boolean {
  // An entry may narrow by name or namespace; omitted (or empty, which is how
  // the API reports "unset") means every resource of that group and kind.
  return (
    (rule.group ?? "") === (resource.group ?? "") &&
    rule.kind === resource.kind &&
    (rule.name === undefined ||
      rule.name === "" ||
      rule.name === resource.name) &&
    (rule.namespace === undefined ||
      rule.namespace === "" ||
      rule.namespace === resource.namespace)
  );
}

function withoutKey(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).filter(([candidate]) => candidate !== key),
  );
}

/**
 * A copy of the document without one pointer's subtree, or `undefined` when
 * that cannot be done exactly. An array along the path is refused rather than
 * spliced: removing an element renumbers its siblings, so the pruned document
 * would no longer describe what Argo applies, and a wrong relaxation here is a
 * rejected apply mid-release. Rebuilding rather than deleting in place also
 * keeps this honest about `JsonObjectSchema.safeParse`, which returns a copy —
 * mutating what it hands back changes nothing the caller can see.
 */
function withoutPath(
  object: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> | undefined {
  const head = path[0];
  if (head === undefined) {
    return undefined;
  }
  if (path.length === 1) {
    return withoutKey(object, head);
  }
  const child = object[head];
  if (Array.isArray(child)) {
    return undefined;
  }
  const parsed = JsonObjectSchema.safeParse(child);
  if (!parsed.success) {
    // Nothing at that path on this side. The other side still gets pruned,
    // which is what makes an added or removed subtree compare equal.
    return object;
  }
  const remaining = withoutPath(parsed.data, path.slice(1));
  return remaining === undefined ? undefined : { ...object, [head]: remaining };
}

function prunedState(
  source: string | undefined,
  paths: readonly (readonly string[])[],
  resource: ManagedResource,
  field: "liveState" | "targetState",
): string | undefined {
  const parsed = parseObject(source, resource, field);
  if (parsed === null) {
    return source;
  }
  let current = parsed;
  let pruned = false;
  for (const path of paths) {
    const remaining = withoutPath(current, path);
    if (remaining !== undefined) {
      current = remaining;
      pruned = true;
    }
  }
  return pruned ? JSON.stringify(current) : source;
}

/**
 * Model what the sync will actually send. An Application that declares
 * `ignoreDifferences` together with `RespectIgnoreDifferences=true` keeps those
 * paths at their live values, so the API server never sees a change there and
 * cannot reject one. Comparing them anyway refuses a sync that provably
 * succeeds — an itzg Minecraft chart bump moves only the `chart` and
 * `app.kubernetes.io/version` labels inside `volumeClaimTemplates`, which that
 * Application already ignores for exactly this reason, and the preflight
 * blocked every main release until this was taught the same rule.
 *
 * Relaxation is deliberately narrow. Without `RespectIgnoreDifferences=true`
 * the field is still applied and still has to be checked, so hiding a
 * difference from the diff changes nothing here. Only `jsonPointers` are
 * honored: `jqPathExpressions` and `managedFieldsManagers` select fields this
 * cannot resolve without a jq engine or the live field-manager set, and an
 * exemption it cannot compute must stay unexempted.
 */
export function withIgnoredDifferencesApplied(
  resources: readonly ManagedResource[],
  application: unknown,
): readonly ManagedResource[] {
  const parsed = ApplicationIgnoreRulesSchema.parse(application);
  const spec = parsed.spec;
  if (
    spec?.ignoreDifferences === undefined ||
    !(spec.syncPolicy?.syncOptions ?? []).includes(RESPECT_IGNORE_DIFFERENCES)
  ) {
    return resources;
  }
  const rules = spec.ignoreDifferences;
  return resources.map((resource) => {
    const paths = rules
      .filter((rule) => ignoreRuleMatches(rule, resource))
      .flatMap((rule) => rule.jsonPointers ?? [])
      .map((pointer) => pointerSegments(pointer))
      .filter((path) => path !== undefined);
    if (paths.length === 0) {
      return resource;
    }
    const liveState = prunedState(
      resource.liveState,
      paths,
      resource,
      "liveState",
    );
    const targetState = prunedState(
      resource.targetState,
      paths,
      resource,
      "targetState",
    );
    return {
      ...resource,
      ...(liveState === undefined ? {} : { liveState }),
      ...(targetState === undefined ? {} : { targetState }),
    };
  });
}
