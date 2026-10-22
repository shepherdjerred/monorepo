import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { catalogApplicationEnvironment } from "@shepherdjerred/ops-model/delivery-catalog/applications.ts";
import {
  ORDINARY_DELIVERY_ENVIRONMENTS,
  SPECIALIZED_DELIVERY_ENVIRONMENTS,
} from "./delivery-target-policy.ts";

/** Registration is declarative; selected release fields belong to Delivery. */
export const DELIVERY_ENVIRONMENT_ANNOTATION =
  "delivery.shepherdjerred.com/environment";

/** Allowed registrations, not activation or selected-version state. */
export const DELIVERY_DELEGATION_DEFINITIONS: Readonly<Record<string, string>> =
  { ...ORDINARY_DELIVERY_ENVIRONMENTS, ...SPECIALIZED_DELIVERY_ENVIRONMENTS };

/** Cut over after importing observed state and validating the target pipeline. */
export const DELIVERY_ACTIVE_DELEGATIONS: Readonly<Record<string, string>> =
  SERVICE_CATALOG.deliveryDelegations ?? {};

const OwnershipSchema = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

/**
 * The v1 environment an Application is delegated to, or undefined when v1
 * does not deploy it. Transition rendering also stamps every other child
 * Application with its catalog environment, the ownership marker the first
 * v2 deployment reads; that marker is not a v1 delegation. Any other value is
 * a broken registration and fails.
 */
export function deliveryEnvironment(input: unknown): string | undefined {
  const object = OwnershipSchema.parse(input);
  if (object.kind !== "Application") return undefined;
  const environment =
    object.metadata.annotations?.[DELIVERY_ENVIRONMENT_ANNOTATION];
  if (environment === undefined) return undefined;
  const { name } = object.metadata;
  if (name === "apps" || environment.trim() === "")
    throw new Error(
      "Delivery delegation requires a non-root Application and environment",
    );
  if (DELIVERY_DELEGATION_DEFINITIONS[name] === environment) {
    if (name === "argocd")
      throw new Error(
        "Delivery delegation requires a non-root Application and environment",
      );
    return environment;
  }
  if (catalogApplicationEnvironment(name) === environment) return undefined;
  throw new Error(
    "Delivery delegation is absent from the reviewed Application registration",
  );
}

/** Exact fields delegated to Delivery, preserved during root synchronization. */
export const DELIVERY_ROOT_IGNORE_EXPRESSIONS = [
  `. | select(.metadata.annotations["${DELIVERY_ENVIRONMENT_ANNOTATION}"] != null) | .spec.source.targetRevision`,
  `. | select(.metadata.annotations["${DELIVERY_ENVIRONMENT_ANNOTATION}"] != null) | .spec.source.helm.parameters`,
];

/**
 * Under transition rendering every child carries the annotation, so the root
 * preserves the fields of v1's active delegations by name: the final v1 root
 * release must still move every other child to its published revision.
 */
export const TRANSITION_ROOT_IGNORE_EXPRESSIONS = (() => {
  const delegated = Object.keys(DELIVERY_ACTIVE_DELEGATIONS)
    .sort()
    .map((name) => `.metadata.name == ${JSON.stringify(name)}`)
    .join(" or ");
  return [".spec.source.targetRevision", ".spec.source.helm.parameters"].map(
    (field) =>
      `. | select(.metadata.annotations["${DELIVERY_ENVIRONMENT_ANNOTATION}"] != null and (${delegated})) | ${field}`,
  );
})();

/** The root's preserved-field expressions for a transition rendering state. */
export function deliveryRootIgnoreExpressions(transition: boolean): string[] {
  return transition
    ? TRANSITION_ROOT_IGNORE_EXPRESSIONS
    : DELIVERY_ROOT_IGNORE_EXPRESSIONS;
}
