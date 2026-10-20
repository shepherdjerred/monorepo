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
/** Another service's component filled by reference (A5). */
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
});
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
export const CatalogConfigurationSchema = z
  .strictObject({
    id: RevisionIdSchema,
    content: z.record(z.string().min(1), z.string()),
    /** Keys a rollback may never lower (F3); each holds a dotted numeric version. */
    forwardOnly: z.array(z.string().min(1)),
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
      const value = configuration.content[key];
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
