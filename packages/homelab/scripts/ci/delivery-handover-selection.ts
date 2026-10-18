import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import {
  DELIVERY_DELEGATION_DEFINITIONS,
  DELIVERY_ENVIRONMENT_ANNOTATION,
} from "#delivery-ownership";
import {
  BootstrapApplicationSchema,
  bootstrapFingerprint,
  assertBootstrapRootPaused,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";

export const HandoverDescriptorSchema = z.strictObject({
  schema: z.literal("delivery-ownership-handover/v1"),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  pullRequest: z.number().int().positive(),
  requestId: z.uuid(),
  deliveryUrl: z.literal("https://delivery.tailnet-1a49.ts.net"),
  woodpeckerWebhookId: z.number().int().positive(),
  targets: z
    .array(
      z.strictObject({
        application: z.string().min(1),
        environmentId: z.string().min(1),
        expectedGeneration: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (targets) =>
        new Set(targets.map((target) => target.application)).size ===
        targets.length,
      "Duplicate handover target",
    ),
});
export type HandoverDescriptor = z.infer<typeof HandoverDescriptorSchema>;

// Only the fields needed from the authenticated API are projected here. The
// original complete payload is retained separately and fingerprinted as evidence.
export const HandoverContextSchema = z
  .object({
    schema: z.literal("delivery-ownership-context/v1"),
    sourceRevision: z.string(),
    catalogFingerprint: z.string(),
    observedAt: z.iso.datetime(),
    writesEnabled: z.literal(false),
    enabledEnvironments: z.array(z.string()),
    counts: z
      .record(z.string(), z.number().int().nonnegative())
      .refine(
        (counts) =>
          [
            "applicationLocks",
            "platformLocks",
            "activeEnvironments",
            "pendingDeployments",
            "recoveryRequired",
            "pendingObservations",
          ].every((key) => counts[key] === 0),
        "PG requests, ownership or recovery are not quiescent",
      ),
    targets: z.array(
      z
        .object({
          environmentId: z.string(),
          serviceId: z.string(),
          application: z.string(),
          generation: z.number().int().nonnegative(),
          pipelineRevisionId: z.string(),
          configurationRevision: z.string(),
          configuration: z.record(z.string(), z.string()),
          acceptedVersionSetRevisionId: z.string().nullable(),
          pipeline: z
            .object({
              kind: z.enum(["argocd", "control-plane"]),
              application: z.string(),
              namespace: z.string().optional(),
              chartRepository: z.string(),
              chartName: z.string(),
              workerRollout: z.unknown().optional(),
              forumRelease: z.unknown().optional(),
            })
            .loose(),
          baseline: z
            .object({
              kind: z.enum(["worker", "forum"]),
              id: z.string(),
              fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            })
            .nullable(),
        })
        .loose(),
    ),
  })
  .loose();

function requireHandoverBaseline(
  row: z.infer<typeof HandoverContextSchema>["targets"][number],
) {
  if (
    row.pipeline.workerRollout !== undefined &&
    row.baseline?.kind !== "worker"
  )
    throw new Error(
      "Worker handover requires its independently verified original host baseline",
    );
  if (
    row.pipeline.forumRelease !== undefined &&
    row.acceptedVersionSetRevisionId === null &&
    row.baseline?.kind !== "forum"
  )
    throw new Error(
      "Forum handover requires its independently verified original runtime baseline",
    );
}

export function handoverContext(
  raw: unknown,
  descriptor: HandoverDescriptor,
  catalog = SERVICE_CATALOG,
) {
  const context = HandoverContextSchema.parse(raw);
  if (
    context.sourceRevision !== descriptor.sourceRevision ||
    context.catalogFingerprint !== bootstrapFingerprint(catalog)
  )
    throw new Error(
      "API image source/catalog must equal the exact reviewed handover checkout",
    );
  if (
    Date.parse(context.observedAt) < Date.now() - 30_000 ||
    Date.parse(context.observedAt) > Date.now() + 5000
  )
    throw new Error("Ownership handover PG observation is not fresh");
  for (const target of descriptor.targets) {
    if (
      DELIVERY_DELEGATION_DEFINITIONS[target.application] !==
        target.environmentId ||
      catalog.deliveryDelegations?.[target.application] !== target.environmentId
    )
      throw new Error(
        "Handover target lacks its exact reviewed source delegation",
      );
    const registered = context.targets.filter(
      (row) =>
        row.environmentId === target.environmentId &&
        row.application === target.application,
    );
    const row = registered[0];
    if (
      registered.length !== 1 ||
      row?.generation !== target.expectedGeneration ||
      row.pipeline.application !== target.application
    )
      throw new Error(
        "Registered handover generation/pipeline differs from operator intent",
      );
    requireHandoverBaseline(row);
  }
  return context;
}

export function handoverContextFingerprint(raw: unknown) {
  const context = HandoverContextSchema.parse(raw);
  const { observedAt: _observed, ...identity } = context;
  return bootstrapFingerprint(identity);
}

export function handoverPatch(
  raw: unknown,
  registered: z.infer<typeof HandoverContextSchema>["targets"][number],
) {
  const app = BootstrapApplicationSchema.parse(raw);
  const original = z
    .object({
      source: z.object({ repoURL: z.string(), chart: z.string() }).loose(),
      sources: z.never().optional(),
      destination: z.object({ namespace: z.string() }),
      syncPolicy: z.record(z.string(), z.json()).optional(),
    })
    .parse(app.spec);
  if (
    app.metadata.name !== registered.application ||
    original.source.repoURL !== registered.pipeline.chartRepository ||
    original.source.chart !== registered.pipeline.chartName ||
    (registered.pipeline.namespace !== undefined &&
      original.destination.namespace !== registered.pipeline.namespace)
  )
    throw new Error(
      "Native Application source/destination does not match its registered pipeline; handover never changes selected sources",
    );
  const prior = app.metadata.annotations[DELIVERY_ENVIRONMENT_ANNOTATION];
  if (prior !== undefined && prior !== registered.environmentId)
    throw new Error(
      "Application already belongs to a different deployment owner",
    );
  const policy = original.syncPolicy ?? {};
  const automated =
    policy["automated"] == null
      ? {}
      : z.record(z.string(), z.json()).parse(policy["automated"]);
  return {
    app,
    patch: [
      { op: "test", path: "/metadata/uid", value: app.metadata.uid },
      {
        op: "test",
        path: "/metadata/resourceVersion",
        value: app.metadata.resourceVersion,
      },
      { op: "test", path: "/spec/source", value: app.spec["source"] },
      {
        op: "add",
        path: "/metadata/annotations",
        value: {
          ...app.metadata.annotations,
          [DELIVERY_ENVIRONMENT_ANNOTATION]: registered.environmentId,
        },
      },
      {
        op: "add",
        path: "/spec/syncPolicy",
        value: { ...policy, automated: { ...automated, enabled: false } },
      },
    ],
  };
}

export function handoverApplicationIdentity(app: BootstrapApplication) {
  const { resourceVersion: _version, ...metadata } = app.metadata;
  return bootstrapFingerprint({ metadata, spec: app.spec });
}

/** Root stays paused; any unexplained shared-resource drift fails before ownership changes. */
export function assertHandoverRoot(raw: unknown, targets: string[]) {
  const root = BootstrapApplicationSchema.parse(raw);
  assertBootstrapRootPaused(root);
  const state = z
    .object({
      status: z.object({
        resources: z
          .array(
            z.object({
              kind: z.string(),
              name: z.string(),
              status: z.string(),
            }),
          )
          .optional(),
      }),
    })
    .parse(raw);
  if (root.status.sync.status === "OutOfSync") {
    const allowed = new Set(["apps", ...targets]);
    const resources = state.status.resources;
    if (resources?.some((item) => item.status === "OutOfSync") !== true)
      throw new Error("Unexplained root drift prevents ownership handover");
    if (
      resources.some(
        (item) =>
          item.status !== "Synced" &&
          !(
            item.status === "OutOfSync" &&
            item.kind === "Application" &&
            allowed.has(item.name)
          ),
      )
    )
      throw new Error(
        "Unrelated root resource drift prevents ownership handover",
      );
  }
  return root;
}
