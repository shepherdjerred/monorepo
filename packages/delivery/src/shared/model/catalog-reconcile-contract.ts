import { z } from "zod";
import { EnvironmentIdSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";

/**
 * A request to make the record agree with one catalog document (model
 * 4.1). The document is parsed by `CatalogDocumentSchema` on the server.
 * `renames` carries v1 environment ids onto their catalog successors with
 * their history and accepted selection, because the target instance (a
 * bucket, a state key, an Application) is unchanged; `retired` names v1
 * environments with no successor.
 */
export const CatalogReconcileRequestSchema = z.strictObject({
  document: z.unknown(),
  renames: z.record(IdentifierSchema, EnvironmentIdSchema).default({}),
  retired: z.array(IdentifierSchema).default([]),
});
export type CatalogReconcileRequest = z.input<
  typeof CatalogReconcileRequestSchema
>;

const IdList = z.array(z.string().min(1));
export const CatalogReconcileResultSchema = z.strictObject({
  catalogRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  services: z.strictObject({
    created: IdList,
    lineageChanged: IdList,
    retired: IdList,
  }),
  environments: z.strictObject({
    created: IdList,
    renamed: z.array(
      z.strictObject({ from: z.string().min(1), to: EnvironmentIdSchema }),
    ),
    rebound: IdList,
    retired: IdList,
  }),
  recipes: z.strictObject({ created: IdList }),
  configurations: z.strictObject({ created: IdList }),
  edges: z.number().int().nonnegative(),
  references: z.number().int().nonnegative(),
});
export type CatalogReconcileResult = z.infer<
  typeof CatalogReconcileResultSchema
>;
