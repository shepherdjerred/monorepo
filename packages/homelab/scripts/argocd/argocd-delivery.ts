import { z } from "zod";
import {
  DELIVERY_ENVIRONMENT_ANNOTATION,
  DELIVERY_ROOT_IGNORE_EXPRESSIONS,
  deliveryEnvironment,
} from "#delivery-ownership";

export const DeliverySelectionSchema = z.object({
  application: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  environmentId: z.string().min(1),
  repository: z.url(),
  chart: z.string().min(1),
  revision: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  namespace: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.string()),
});
export type DeliverySelection = z.infer<typeof DeliverySelectionSchema>;

/** Preserve literal strings through Helm's strvals grammar, including JSON objects. */
export function deliveryArgoParameters(
  parameters: DeliverySelection["parameters"],
) {
  return Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      value: value.replaceAll(/[\\{},]/gu, String.raw`\$&`),
      forceString: true as const,
    }));
}

export const DeliveryArgoSourceSchema = z
  .object({
    repoURL: z.string(),
    chart: z.string(),
    targetRevision: z.string(),
    helm: z
      .object({
        parameters: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              forceString: z.boolean().optional(),
            }),
          )
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
const ApplicationSchema = z.object({
  kind: z.literal("Application").default("Application"),
  operation: z.null().optional(),
  status: z
    .object({
      operationState: z
        .object({
          phase: z.enum([
            "Running",
            "Terminating",
            "Succeeded",
            "Failed",
            "Error",
          ]),
        })
        .optional(),
    })
    .optional(),
  metadata: z.object({
    name: z.string(),
    resourceVersion: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    source: DeliveryArgoSourceSchema,
    sources: z.unknown().optional(),
    destination: z.object({ namespace: z.string() }),
    syncPolicy: z.record(z.string(), z.unknown()).optional(),
  }),
});

/**
 * Never let the service take an application away from its existing owner.
 * Between deployments the accepted exact source may be self-healed by ArgoCD;
 * the selection patch switches automation off in the same write so the owned
 * `sync-managed` operation is the only sync of the new source (T4, T5).
 */
export function deliverySelectionPatch(
  input: unknown,
  desired: DeliverySelection,
) {
  const selection = DeliverySelectionSchema.parse(desired);
  const application = ApplicationSchema.parse(input);
  if (
    ["Running", "Terminating"].includes(
      application.status?.operationState?.phase ?? "",
    )
  )
    throw new Error(
      "Application operation is not settled; retain Delivery ownership",
    );
  if (
    deliveryEnvironment(application) !== selection.environmentId ||
    application.metadata.name !== selection.application
  )
    throw new Error(
      "Application has not been delegated to this Delivery environment",
    );
  if (application.spec.sources !== undefined)
    throw new Error("Delivery requires a single-source Application");
  const source = application.spec.source;
  if (
    source.repoURL !== selection.repository ||
    source.chart !== selection.chart ||
    (selection.namespace !== undefined &&
      application.spec.destination.namespace !== selection.namespace)
  )
    throw new Error(
      "Selected release does not match the registered Application destination/source",
    );
  const parameters = deliveryArgoParameters(selection.parameters);
  const selected = {
    ...source,
    targetRevision: selection.revision,
    helm: { ...source.helm, parameters },
  };
  return [
    {
      op: "test",
      path: "/metadata/resourceVersion",
      value: application.metadata.resourceVersion,
    },
    {
      op: "test",
      path: `/metadata/annotations/${DELIVERY_ENVIRONMENT_ANNOTATION.replaceAll("/", "~1")}`,
      value: selection.environmentId,
    },
    { op: "replace", path: "/spec/source", value: selected },
    application.spec.syncPolicy === undefined
      ? {
          op: "add",
          path: "/spec/syncPolicy",
          value: { automated: { enabled: false } },
        }
      : {
          op: "add",
          path: "/spec/syncPolicy/automated",
          value: { enabled: false },
        },
  ];
}

/** Comparison ignores alone do not prevent a root sync from reverting selection. */
export function assertDeliveryRootPreservesSelection(input: unknown): void {
  const root = z
    .object({
      spec: z.object({
        syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
        ignoreDifferences: z.array(
          z.object({
            group: z.string(),
            kind: z.string(),
            jqPathExpressions: z.array(z.string()).optional(),
          }),
        ),
      }),
    })
    .parse(input);
  const expressions = new Set(
    root.spec.ignoreDifferences
      .filter(
        (rule) => rule.group === "argoproj.io" && rule.kind === "Application",
      )
      .flatMap((rule) => rule.jqPathExpressions ?? []),
  );
  if (
    !root.spec.syncPolicy.syncOptions.includes(
      "RespectIgnoreDifferences=true",
    ) ||
    DELIVERY_ROOT_IGNORE_EXPRESSIONS.some(
      (expression) => !expressions.has(expression),
    )
  )
    throw new Error(
      "Root Application does not preserve Delivery-owned release fields",
    );
}
