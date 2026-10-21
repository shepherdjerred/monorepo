import { z } from "zod";

/**
 * Structural schemas of the catalog document (Delivery model, section 4.1),
 * mirroring `catalog-document.schema.json`. `catalog-document.ts` adds the
 * cross-field rules and the complete document schema.
 */

export const ServiceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
export const ComponentTypeSchema = z.enum(["image", "chart", "archive"]);
/** Component names carry their type as a prefix (4.3). */
export const ComponentNameSchema = z
  .string()
  .regex(/^(?:image|chart|archive):[a-z0-9][a-z0-9._-]*$/u);
export const ImageComponentNameSchema = z
  .string()
  .regex(/^image:[a-z0-9][a-z0-9._-]*$/u);
export const ChartComponentNameSchema = z
  .string()
  .regex(/^chart:[a-z0-9][a-z0-9._-]*$/u);
export const ArchiveComponentNameSchema = z
  .string()
  .regex(/^archive:[a-z0-9][a-z0-9._-]*$/u);
/** `service/name` (4.10). */
export const EnvironmentIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u);
/** A recipe or configuration id with its revision suffix, such as `scout-prod/3`. */
export const RevisionIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\/[1-9]\d*$/u);

export function componentType(name: string): string {
  return name.slice(0, name.indexOf(":"));
}
export function environmentService(environmentId: string): string {
  return environmentId.slice(0, environmentId.indexOf("/"));
}

export const ComponentProducerSchema = z.enum([
  "first-party",
  "acquisition",
  "reference",
]);
export const ReferenceModeSchema = z.enum(["pinned", "tracking"]);
/**
 * Another service's component filled by reference (A5). A `tracking`
 * reference follows the acceptances of one source environment (R7); a
 * producer with no environment of its own, such as an image only another
 * service's chart consumes, is referenced `pinned` and moves by a manual
 * set revision or a catalog change.
 */
export const ComponentSourceSchema = z
  .strictObject({
    service: ServiceIdSchema,
    component: ComponentNameSchema,
    mode: ReferenceModeSchema,
    environment: EnvironmentIdSchema.optional(),
  })
  .superRefine((source, context) => {
    if ((source.mode === "tracking") !== (source.environment !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "A tracking reference names the source environment it follows; a pinned reference names none",
      });
    }
  });
export const CatalogComponentSchema = z
  .strictObject({
    name: ComponentNameSchema,
    producer: ComponentProducerSchema,
    source: ComponentSourceSchema.optional(),
  })
  .superRefine((component, context) => {
    if (
      (component.producer === "reference") !==
      (component.source !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A reference component names its source; first-party and acquired components name none",
      });
    }
  });
export type CatalogComponent = z.infer<typeof CatalogComponentSchema>;

/** Forward-only lifecycle of services and environments (4.2, 4.10). */
export const LifecycleSchema = z.enum(["active", "retired", "removed"]);
/** The ops view that aggregates this service: today's ops-model service id. */
export const ServiceGroupSchema = ServiceIdSchema;
const NameListSchema = z.array(z.string().min(1)).default([]);
/** Attributes the ops consumers read and Delivery never does. Images and charts derive from the components. */
export const OpsAttributesSchema = z.strictObject({
  kind: z.enum(["product", "workload", "platform"]),
  aliases: z.array(ServiceIdSchema).default([]),
  namespaces: NameListSchema,
  argoApps: NameListSchema,
  bugsinkProjects: NameListSchema,
  analyticsSites: NameListSchema,
  grafanaDashboards: NameListSchema,
});
/** Transitional v1 release-owner material; deleted with the root release after the window. */
export const LegacyServiceSchema = z.strictObject({
  rootReleaseExclusions: z
    .record(z.string().min(1), z.enum(["upstream", "inactive"]))
    .optional(),
  deploy: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        versionKey: z.string().min(1),
        argoApp: z.string().min(1),
      }),
    )
    .optional(),
  bootstrapImages: z.array(z.string().min(1)).optional(),
  /** Packaged charts the v1 ops view owns beyond its ArgoCD Applications. */
  charts: z.array(z.string().min(1)).optional(),
});
/** An ArgoCD AppProject name. */
export const AppProjectNameSchema = z
  .string()
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u)
  .max(253);
export const CatalogServiceSchema = z.strictObject({
  id: ServiceIdSchema,
  title: z.string().min(1),
  package: z.string().min(1).optional(),
  lifecycle: LifecycleSchema,
  /** Its target hosts the executor, the API or the Kubernetes adapter (D8). */
  selfHosted: z.boolean(),
  group: ServiceGroupSchema,
  /** Ordered; a change starts a new lineage (S1). */
  components: z.array(CatalogComponentSchema),
  /**
   * ArgoCD AppProjects this service's chart renders. Every Application a
   * recipe declares names a project some service owns, so no project loses
   * its owner when the root release is retired.
   */
  appProjects: z.array(AppProjectNameSchema).optional(),
  ops: OpsAttributesSchema.optional(),
  legacy: LegacyServiceSchema.optional(),
});
export type CatalogService = z.infer<typeof CatalogServiceSchema>;

export const EnvironmentRoleSchema = z.enum([
  "durable",
  "replica",
  "qualification",
]);
export const ApprovalPolicySchema = z.enum(["none", "required"]);
export const CatalogEnvironmentSchema = z
  .strictObject({
    id: EnvironmentIdSchema,
    role: EnvironmentRoleSchema,
    lifecycle: LifecycleSchema.default("active"),
    approvalPolicy: ApprovalPolicySchema,
    automatic: z.boolean(),
    promotionSourceEnvironmentId: EnvironmentIdSchema.optional(),
    recipeRevisionId: RevisionIdSchema,
    configurationRevisionId: RevisionIdSchema,
    /** The durable environment a replica mirrors (E7). */
    durableParent: EnvironmentIdSchema.optional(),
  })
  .superRefine((environment, context) => {
    if (
      (environment.role === "replica") !==
      (environment.durableParent !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A replica names the durable environment it mirrors; durable and qualification environments name none",
      });
    }
  });
export type CatalogEnvironment = z.infer<typeof CatalogEnvironmentSchema>;

export const RecipeKindSchema = z.enum([
  "kubernetes-application",
  "static-site",
  "tofu",
  "channel",
  "operator-run",
  "compound",
]);
/** Structural view of a recipe; Delivery's `RecipeDefinitionSchema` types the body. */
export const CatalogRecipeSchema = z.strictObject({
  id: RevisionIdSchema,
  definition: z.looseObject({ kind: RecipeKindSchema }),
});

export const ForwardOnlyValueSchema = z.string().regex(/^\d+(?:\.\d+)*$/u);

/** The content key whose JSON value becomes the Application's `helm.valuesObject`. */
export const HELM_VALUES_OBJECT_KEY = "helm.valuesObject";

/**
 * The structured view of a configuration revision's content (4.8): the
 * `helm.valuesObject` key's JSON value at `/helm/valuesObject`, every other
 * key a Helm parameter at `/helm/parameters/<key>`. Forward-only keys are
 * JSON pointers into this view (F3).
 */
export function configurationDocument(
  content: Readonly<Record<string, string>>,
): { helm: { valuesObject?: unknown; parameters: Record<string, string> } } {
  const parameters: Record<string, string> = {};
  let valuesObject: unknown;
  for (const [key, value] of Object.entries(content)) {
    if (key === HELM_VALUES_OBJECT_KEY) valuesObject = JSON.parse(value);
    else parameters[key] = value;
  }
  return {
    helm:
      valuesObject === undefined
        ? { parameters }
        : { valuesObject, parameters },
  };
}

/** An RFC 6901 JSON pointer such as `/helm/valuesObject/minecraftServer/version`. */
export const JsonPointerSchema = z.string().regex(/^(?:\/(?:[^~/]|~[01])*)+$/u);

/**
 * The scalar a forward-only JSON pointer names in the configuration's
 * structured view (F3), as a string; undefined when nothing scalar is there.
 */
export function forwardOnlyValue(
  content: Readonly<Record<string, string>>,
  pointer: string,
): string | undefined {
  let cursor: unknown = configurationDocument(content);
  for (const token of JsonPointerSchema.parse(pointer).slice(1).split("/")) {
    const name = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = Object.entries(cursor).find(([key]) => key === name)?.[1];
  }
  if (typeof cursor === "number") return String(cursor);
  return typeof cursor === "string" ? cursor : undefined;
}
export const CatalogConfigurationSchema = z
  .strictObject({
    id: RevisionIdSchema,
    content: z.record(z.string().min(1), z.string()),
    /**
     * JSON pointers into the content's structured view a rollback may never
     * lower (F3); each names a dotted numeric version.
     */
    forwardOnly: z.array(JsonPointerSchema),
  })
  .superRefine((configuration, context) => {
    if (
      new Set(configuration.forwardOnly).size !==
      configuration.forwardOnly.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["forwardOnly"],
        message: "forwardOnly keys must be unique",
      });
    }
    for (const key of configuration.forwardOnly) {
      const value = forwardOnlyValue(configuration.content, key);
      if (value === undefined) {
        context.addIssue({
          code: "custom",
          path: ["forwardOnly"],
          message: `forwardOnly key ${key} is absent from the configuration content`,
        });
      } else if (!ForwardOnlyValueSchema.safeParse(value).success) {
        context.addIssue({
          code: "custom",
          path: ["content", key],
          message: `forwardOnly key ${key} must hold a dotted numeric version so candidates can be ordered (F3)`,
        });
      }
    }
  });
export type CatalogConfiguration = z.infer<typeof CatalogConfigurationSchema>;

export const EdgeRuleSchema = z.enum([
  "any-accepted",
  "same-or-later-order-key",
]);
export const PrerequisiteEdgeSchema = z.strictObject({
  dependent: EnvironmentIdSchema,
  prerequisite: EnvironmentIdSchema,
  rule: EdgeRuleSchema,
});
export type PrerequisiteEdge = z.infer<typeof PrerequisiteEdgeSchema>;

/** An ops view: the coarse service today's consumers know, aggregating the fine-grained services that name it as their group. */
export const CatalogGroupSchema = z.strictObject({
  id: ServiceIdSchema,
  title: z.string().min(1),
  kind: z.enum(["product", "workload", "platform"]),
  package: z.string().min(1).optional(),
  aliases: z.array(ServiceIdSchema).default([]),
});
export type CatalogGroup = z.infer<typeof CatalogGroupSchema>;

/** Transitional v1 ownership policy; deleted with the root release after the window. */
export const LegacyDocumentSchema = z.strictObject({
  deliveryDelegations: z
    .record(z.string().min(1), EnvironmentIdSchema)
    .optional(),
  platformDeliveryDelegated: z.boolean().optional(),
});
export const catalogDocumentShape = {
  $schema: z.string().optional(),
  groups: z.array(CatalogGroupSchema).min(1),
  services: z.array(CatalogServiceSchema).min(1),
  environments: z.array(CatalogEnvironmentSchema),
  recipes: z.array(CatalogRecipeSchema),
  configurations: z.array(CatalogConfigurationSchema),
  edges: z.array(PrerequisiteEdgeSchema),
  legacy: LegacyDocumentSchema.optional(),
};
export const CatalogDocumentBaseSchema = z.strictObject(catalogDocumentShape);
export type CatalogDocumentBase = z.infer<typeof CatalogDocumentBaseSchema>;
