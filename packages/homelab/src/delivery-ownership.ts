import { z } from "zod";

/** Registration is declarative; selected release fields belong to Delivery. */
export const DELIVERY_ENVIRONMENT_ANNOTATION =
  "delivery.shepherdjerred.com/environment";

/** Allowed registrations, not activation or selected-version state. */
export const DELIVERY_DELEGATION_DEFINITIONS: Readonly<Record<string, string>> =
  {
    arcade: "arcade/prod",
  };

/** Cut over after importing observed state and validating the target pipeline. */
export const DELIVERY_ACTIVE_DELEGATIONS: Readonly<Record<string, string>> = {};

const OwnershipSchema = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

export function deliveryEnvironment(input: unknown): string | undefined {
  const object = OwnershipSchema.parse(input);
  if (object.kind !== "Application") return undefined;
  const environment =
    object.metadata.annotations?.[DELIVERY_ENVIRONMENT_ANNOTATION];
  if (environment === undefined) return undefined;
  if (
    environment.trim() === "" ||
    ["apps", "argocd"].includes(object.metadata.name)
  )
    throw new Error(
      "Delivery delegation requires a non-root Application and environment",
    );
  if (DELIVERY_DELEGATION_DEFINITIONS[object.metadata.name] !== environment)
    throw new Error(
      "Delivery delegation is absent from the reviewed Application registration",
    );
  return environment;
}

/** Exact fields delegated to Delivery, preserved during root synchronization. */
export const DELIVERY_ROOT_IGNORE_EXPRESSIONS = [
  `. | select(.metadata.annotations["${DELIVERY_ENVIRONMENT_ANNOTATION}"] != null) | .spec.source.targetRevision`,
  `. | select(.metadata.annotations["${DELIVERY_ENVIRONMENT_ANNOTATION}"] != null) | .spec.source.helm.parameters`,
];
