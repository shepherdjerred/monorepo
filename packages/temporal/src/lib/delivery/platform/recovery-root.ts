import { z } from "zod";
import {
  isVerifiedRootReleaseTermination,
  VERIFIED_ROOT_RELEASE_ANNOTATION,
  VerifiedRootReleaseReceiptSchema,
} from "@shepherdjerred/ops-model/argocd-release-receipt.ts";
import type {
  PlatformRecoveryContext,
  ArtifactVersion,
  PlatformReleaseSnapshot,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";

const Application = z.object({
  operation: z.null().optional(),
  spec: z.object({
    source: z
      .object({
        repoURL: z.literal("https://chartmuseum.tailnet-1a49.ts.net"),
        chart: z.string(),
        targetRevision: z.string(),
      })
      .loose(),
  }),
  status: z.object({
    sync: z.object({ status: z.literal("Synced"), revision: z.string() }),
    health: z.object({ status: z.literal("Healthy") }).optional(),
    operationState: z.object({ phase: z.string() }),
  }),
});
type RootSnapshot = Extract<PlatformReleaseSnapshot, { kind: "root-release" }>;
type RootRecoveryContext = {
  deployment: {
    deployment: Pick<
      PlatformRecoveryContext["deployment"]["deployment"],
      "id" | "platformSnapshot"
    >;
  };
  priorDeployment: {
    deployment: Pick<
      PlatformRecoveryContext["deployment"]["deployment"],
      "id" | "platformSnapshot"
    >;
  } | null;
};
function rootRevision(snapshot: RootSnapshot) {
  const chart = snapshot.charts.find(({ name }) => name === "apps");
  if (chart === undefined) throw new Error("Frozen root inventory lacks apps");
  return chart.artifact.version;
}
function selectRoot(context: RootRecoveryContext, raw: unknown) {
  const desired = context.deployment.deployment.platformSnapshot;
  if (desired?.kind !== "root-release")
    throw new Error("Recovery target is not the frozen root release");
  const prior = context.priorDeployment?.deployment.platformSnapshot;
  const root = Application.parse(raw);
  if (
    root.spec.source.chart !== "apps" ||
    !isVerifiedRootReleaseTermination(raw)
  )
    throw new Error(
      "Root lacks its independently verified complete release receipt",
    );
  if (root.spec.source.targetRevision === rootRevision(desired))
    return {
      state: "desired" as const,
      selected: desired,
      ownerId: context.deployment.deployment.id,
    };
  if (
    prior?.kind === "root-release" &&
    root.spec.source.targetRevision === rootRevision(prior)
  )
    return {
      state: "prior" as const,
      selected: prior,
      ownerId: z.string().parse(context.priorDeployment?.deployment.id),
    };
  throw new Error(
    "Root target is not a complete immutable desired/prior release",
  );
}
function renderedSources(manifests: unknown[]) {
  const sources = new Map<string, unknown>();
  for (const input of manifests) {
    const kind = z.object({ kind: z.string() }).parse(input).kind;
    if (kind !== "Application") continue;
    const expected = z
      .object({
        metadata: z.object({ name: z.string() }),
        spec: z.object({ source: z.record(z.string(), z.unknown()) }),
      })
      .parse(input);
    if (sources.has(expected.metadata.name))
      throw new Error("Frozen root chart has duplicate child identities");
    sources.set(expected.metadata.name, expected.spec.source);
  }
  return sources;
}
function requireExactChild(
  raw: unknown,
  expected: { name: string; artifact: ArtifactVersion },
  source: unknown,
) {
  const child = Application.parse(raw);
  if (
    source === undefined ||
    child.spec.source.chart !== expected.name ||
    child.spec.source.targetRevision !== expected.artifact.version ||
    child.status.sync.revision !== expected.artifact.version ||
    child.status.health?.status !== "Healthy" ||
    child.status.operationState.phase !== "Succeeded" ||
    canonicalJson(child.spec.source) !== canonicalJson(source)
  )
    throw new Error(
      "Root child inventory is partial, active or differs from its frozen exact charts",
    );
}

/** Root termination has its own durable verified receipt; generic Succeeded checks are insufficient. */
export async function inspectRootRecovery(
  context: RootRecoveryContext,
  effects: {
    read: (name: string) => Promise<unknown>;
    render: (chart: ArtifactVersion) => Promise<unknown[]>;
  },
) {
  const raw = await effects.read("apps");
  const { state, selected, ownerId } = selectRoot(context, raw);
  const rootSource = Application.parse(raw).spec.source;
  if (
    canonicalJson(rootSource) !==
    canonicalJson({
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "apps",
      targetRevision: rootRevision(selected),
    })
  )
    throw new Error(
      "Root source contains inputs outside the frozen root recipe",
    );
  const identity = z
    .object({
      metadata: z.object({ annotations: z.record(z.string(), z.string()) }),
    })
    .parse(raw);
  const receipt = VerifiedRootReleaseReceiptSchema.parse(
    JSON.parse(
      z
        .string()
        .parse(identity.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION]),
    ),
  );
  if (receipt.requestId !== deliveryOperationId(`${ownerId}:root-release`))
    throw new Error("Root verified receipt belongs to another request");
  const rootChart = selected.charts.find(({ name }) => name === "apps");
  if (rootChart === undefined) throw new Error("Frozen root chart is missing");
  const manifests = await effects.render(rootChart.artifact);
  const sources = renderedSources(manifests);
  for (const chart of selected.charts) {
    if (chart.name === "apps") continue;
    requireExactChild(
      await effects.read(encodeURIComponent(chart.name)),
      chart,
      sources.get(chart.name),
    );
  }
  const after = await effects.read("apps");
  if (
    canonicalJson(selectRoot(context, after)) !==
    canonicalJson({ state, selected, ownerId })
  )
    throw new Error("Root selection changed during independent proof");
  return {
    state,
    observedAt: new Date().toISOString(),
    proofSummary: `Independently verified ${state} root inventory, exact durable request ${receipt.requestId}, native operation ${receipt.operationId}, and all frozen child health/source revisions`,
  } as const;
}
