import { z } from "zod";
import {
  RecipeDefinitionSchema,
  applicationsOf,
  forumReleaseOf,
  workerRolloutOf,
} from "@shepherdjerred/delivery/model-contract";
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
  /**
   * The revision `toolkit deploy catalog reconcile` reported for the reviewed
   * checkout's catalog document. Targets are bound from the API's last
   * reconciled catalog, so it must be exactly this one.
   */
  catalogRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
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
    catalogRevision: z.string(),
    observedAt: z.iso.datetime(),
    writesEnabled: z.literal(false),
    admittingEnvironments: z.array(z.string()),
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
          pipeline: z.union([
            z
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
            z
              .object({
                kind: z.literal("root-release"),
                runnerImage: z.string().min(1),
              })
              .loose(),
            // A target the reconciled catalog binds to a model recipe (4.7).
            RecipeDefinitionSchema,
          ]),
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

type HandoverTarget = z.infer<typeof HandoverContextSchema>["targets"][number];

/**
 * The named Application a registered target releases, read the same way
 * from a v1 pipeline and a model recipe, of which a compound deploys
 * several; null when the pipeline deploys no such Application, as for the
 * root release, which is no leaf handover target.
 */
function registeredApplication(
  pipeline: HandoverTarget["pipeline"],
  application: string,
) {
  switch (pipeline.kind) {
    case "root-release":
      return null;
    case "argocd":
    case "control-plane":
      if (pipeline.application !== application) return null;
      return {
        name: pipeline.application,
        namespace: pipeline.namespace,
        repository: pipeline.chartRepository,
        chart: pipeline.chartName,
        path: null,
        workerRollout: pipeline.workerRollout !== undefined,
        forumRelease: pipeline.forumRelease !== undefined,
      };
    case "kubernetes-application":
    case "compound":
    case "operator-run":
    case "static-site":
    case "tofu":
    case "channel": {
      const view = applicationsOf(pipeline).find(
        (candidate) => candidate.name === application,
      );
      return view === undefined
        ? null
        : {
            name: view.name,
            namespace: view.namespace,
            repository: view.repository,
            chart: view.chart,
            path: view.path,
            workerRollout: workerRolloutOf(pipeline) !== undefined,
            forumRelease: forumReleaseOf(pipeline) !== undefined,
          };
    }
  }
}

function requireHandoverBaseline(row: HandoverTarget) {
  const registered = registeredApplication(row.pipeline, row.application);
  if (registered === null) return;
  if (registered.workerRollout && row.baseline?.kind !== "worker")
    throw new Error(
      "Worker handover requires its independently verified original host baseline",
    );
  if (
    registered.forumRelease &&
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
  if (context.catalogRevision !== descriptor.catalogRevision)
    throw new Error(
      "The API's last reconciled catalog must be the exact reviewed catalog revision; reconcile the reviewed catalog before handover",
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
      registeredApplication(row.pipeline, target.application) === null
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

export function handoverPatch(raw: unknown, registered: HandoverTarget) {
  const source = registeredApplication(
    registered.pipeline,
    registered.application,
  );
  if (source === null)
    throw new Error(
      "Root releases retain the guarded root workflow; they are not leaf handover targets",
    );
  const app = BootstrapApplicationSchema.parse(raw);
  const original = z
    .object({
      source: z
        .object({
          repoURL: z.string(),
          chart: z.string().optional(),
          path: z.string().optional(),
        })
        .loose(),
      sources: z.never().optional(),
      destination: z.object({ namespace: z.string() }),
      syncPolicy: z.record(z.string(), z.json()).optional(),
    })
    .parse(app.spec);
  // A chart source names its chart; a Git source (model recipe) its path.
  if (
    app.metadata.name !== registered.application ||
    original.source.repoURL !== source.repository ||
    (original.source.chart ?? null) !== source.chart ||
    (source.path !== null && original.source.path !== source.path) ||
    (source.namespace !== undefined &&
      original.destination.namespace !== source.namespace)
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
