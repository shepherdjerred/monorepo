import { z } from "zod";
import {
  ApprovalPolicySchema,
  EnvironmentRoleSchema,
  LifecycleSchema,
  RevisionIdSchema,
  ServiceIdSchema,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";
import { EvidenceInputSchema } from "#shared/evidence-contract.ts";
import {
  RecoveryIntentKindSchema,
  RecoveryIntentV2Schema,
} from "#shared/recovery-intent.ts";
import {
  DeploymentDetailSchema,
  DeploymentSchema,
  TofuPlanReceiptSchema,
} from "#shared/contract.ts";
import { ApprovalV2Schema } from "./approval-contract.ts";
import { MonitorStateSchema } from "./monitor-contract.ts";
import type { RecipeKind } from "./recipe-contract.ts";
import { SelectionSchema } from "./selection-contract.ts";

/**
 * Request and response views of the model routes (`/api/v1`) that are not
 * model primitives themselves. The server and every client read these
 * shapes; the primitives stay in their own contract modules.
 */

const TimestampSchema = z.iso.datetime();

/** Every recipe kind (section 5); the mapped type fails to compile when one is missing. */
const recipeKinds: { [Kind in RecipeKind]: Kind } = {
  "kubernetes-application": "kubernetes-application",
  "static-site": "static-site",
  tofu: "tofu",
  channel: "channel",
  "operator-run": "operator-run",
  compound: "compound",
};
export const RecipeKindSchema = z.enum(recipeKinds);
const ReasonSchema = z.string().min(1).max(4000);

/**
 * `GET /environments/:id/selection`: the accepted selection (4.9) beside the
 * binding the catalog declares, so a rebind's effect is visible before it
 * is requested. Within an environment the accepted selection is identified
 * by the deployment that froze it (L1).
 */
export const EnvironmentSelectionSchema = z
  .strictObject({
    accepted: SelectionSchema.nullable(),
    acceptedDeploymentId: IdentifierSchema.nullable(),
    declared: z.strictObject({
      recipeRevisionId: RevisionIdSchema,
      /**
       * The declared recipe's kind. A release freezes the accepted
       * deployment's recipe until a rebind moves the binding, so this is
       * what a release becomes only before the first acceptance.
       */
      recipeKind: RecipeKindSchema,
      configurationRevisionId: RevisionIdSchema,
    }),
    role: EnvironmentRoleSchema,
    lifecycle: LifecycleSchema,
    approvalPolicy: ApprovalPolicySchema,
    bindingGeneration: z.number().int().nonnegative(),
  })
  .refine(
    (view) => (view.accepted === null) === (view.acceptedDeploymentId === null),
    "An accepted selection is named by the deployment that froze it",
  );
export type EnvironmentSelection = z.infer<typeof EnvironmentSelectionSchema>;

/**
 * A deployment as the model routes return it: the v1 record plus its frozen
 * selection, monitor state, the selection it moved away from and, for a
 * rollback, the deployment whose selection it restores. Kinds that froze no
 * selection (retired v1 history) carry null.
 */
export const DeploymentV2Schema = DeploymentSchema.extend({
  selection: SelectionSchema.nullable().default(null),
  monitorState: MonitorStateSchema.nullable().default(null),
  previousAcceptedDeploymentId: IdentifierSchema.nullable().default(null),
  restoredDeploymentId: IdentifierSchema.nullable().default(null),
});
export type DeploymentV2 = z.infer<typeof DeploymentV2Schema>;

/** `GET /deployments/:id` with the approval (4.13) and unified recovery intents (4.15). */
export const DeploymentDetailV2Schema = DeploymentDetailSchema.extend({
  deployment: DeploymentV2Schema,
  approval: ApprovalV2Schema.nullable().default(null),
  recoveryIntents: z.array(RecoveryIntentV2Schema).default([]),
  /**
   * The saved plan a `tofu` recipe's plan step produced (section 5): its
   * digest, expiry, state serial and change summary. The encrypted plan stays
   * with the executor.
   */
  savedPlan: TofuPlanReceiptSchema.nullable().default(null),
});
export type DeploymentDetailV2 = z.infer<typeof DeploymentDetailV2Schema>;

/**
 * `GET /approvals`: deployments whose approval is pending, then those whose
 * approval recently expired or was decided, each with its approval record.
 */
export const ApprovalQueueItemSchema = DeploymentV2Schema.extend({
  approval: ApprovalV2Schema.nullable().default(null),
  /**
   * A running tofu deployment's approve step waits on a human decision of
   * its saved plan (H6); no approval row exists until that decision.
   */
  awaitingPlanDecision: z.boolean().default(false),
});
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItemSchema>;

/** `POST /deployments/:id/recovery-intents` (admin, I1). */
export const RecoveryIntentRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  reason: z.string().min(20).max(4000),
  expectedGeneration: z.number().int().nonnegative(),
  /** The sub-step a compound target's intent names (T3). */
  step: IdentifierSchema.optional(),
  /**
   * The kind the caller can settle. When the deployment's recovery is
   * another kind, the request is refused and no intent is opened.
   */
  expectedKind: RecoveryIntentKindSchema.optional(),
});
export type RecoveryIntentRequest = z.infer<typeof RecoveryIntentRequestSchema>;

/**
 * `POST /deployments/:id/plan-approval` (approve, human): the one decision
 * (4.13) on the exact unexpired saved plan a model `tofu` recipe's approve
 * step waits for. `approved` lets the apply step run; `rejected` discards
 * the plan and ends the deployment failed without applying (H3).
 */
export const ApproveTofuPlanSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  reason: z.string().trim().min(1).max(4000),
});
export type ApproveTofuPlan = z.infer<typeof ApproveTofuPlanSchema>;

/** `POST /deployments/:id/attestations`: operator-attested evidence for one stage (X13). */
export const AttestationRequestSchema = z.strictObject({
  stage: IdentifierSchema,
  evidence: z.array(EvidenceInputSchema).min(1),
});
export type AttestationRequest = z.infer<typeof AttestationRequestSchema>;

const CountSchema = z.number().int().nonnegative();
/** `POST /catalog/reconcile`: what the catalog document created, kept and refused. */
export const CatalogReconcileResultSchema = z.strictObject({
  catalogRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  created: z.strictObject({
    services: CountSchema,
    environments: CountSchema,
    recipes: CountSchema,
    configurations: CountSchema,
    edges: CountSchema,
    /** Section 7: accepted v1 selections carried onto catalog identities. */
    carriedSelections: CountSchema,
  }),
  unchanged: CountSchema,
  refused: z.array(
    z.strictObject({ id: z.string().min(1), reason: ReasonSchema }),
  ),
});
export type CatalogReconcileResult = z.infer<
  typeof CatalogReconcileResultSchema
>;

const IdListSchema = z.array(z.string().min(1));
/**
 * What one catalog reconcile changed, by id: the record `catalog.reconciled`
 * audits, which `GET /activity` returns as the entry's metadata.
 */
export const CatalogReconcileRecordSchema = z.strictObject({
  catalogRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  services: z.strictObject({
    created: IdListSchema,
    lineageChanged: IdListSchema,
    retired: IdListSchema,
  }),
  environments: z.strictObject({
    created: IdListSchema,
    renamed: z.array(
      z.strictObject({ from: z.string().min(1), to: z.string().min(1) }),
    ),
    rebound: IdListSchema,
    retired: IdListSchema,
    /** Section 7: environments whose accepted selection moved onto catalog identities. */
    carried: IdListSchema,
  }),
  recipes: z.strictObject({ created: IdListSchema }),
  configurations: z.strictObject({ created: IdListSchema }),
  edges: CountSchema,
  references: CountSchema,
  unchanged: CountSchema,
  refused: z.array(
    z.strictObject({ id: z.string().min(1), reason: ReasonSchema }),
  ),
});
export type CatalogReconcileRecord = z.infer<
  typeof CatalogReconcileRecordSchema
>;

/** `GET /catalog`: the catalog revision deployments currently freeze. */
export const CatalogStateSchema = z
  .strictObject({
    catalogRevision: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
    reconciledAt: TimestampSchema.nullable(),
  })
  .refine(
    (state) =>
      (state.catalogRevision === null) === (state.reconciledAt === null),
    "A reconciled catalog records when it was reconciled",
  );
export type CatalogState = z.infer<typeof CatalogStateSchema>;

/** `POST /services/:id/retire` (admin). */
export const RetireServiceRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  reason: ReasonSchema,
});
export type RetireServiceRequest = z.infer<typeof RetireServiceRequestSchema>;
/** The retired service; further service fields are kept for display. */
export const ServiceLifecycleViewSchema = z.looseObject({
  id: ServiceIdSchema,
  lifecycle: LifecycleSchema,
});
export type ServiceLifecycleView = z.infer<typeof ServiceLifecycleViewSchema>;
