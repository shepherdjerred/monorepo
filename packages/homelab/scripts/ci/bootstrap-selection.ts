import { createHash } from "node:crypto";
import { parseAllDocuments, stringify } from "yaml";
import { z } from "zod";
import { canonicalJson } from "#scripts/canonical-json.ts";
import { bootstrapPriorRootTermination } from "./bootstrap-root-proof.ts";
import { BootstrapControlPlaneSchema } from "./bootstrap-control-plane.ts";

export const BOOTSTRAP_TARGETS = [
  "woodpecker",
  "delivery",
  "delivery-control-plane",
] as const;
export const BOOTSTRAP_DELIVERY_ORIGIN = "https://delivery.tailnet-1a49.ts.net";
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Revision = z.string().regex(/^2\.0\.0-\d+$/u);
const Image = z.strictObject({
  repository: z.string(),
  digest: Digest,
  version: Revision,
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
});
export const BootstrapDescriptorSchema = z
  .strictObject({
    schema: z.literal("delivery-bootstrap/v1"),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
    pullRequest: z.number().int().positive(),
    deliveryUrl: z.literal(BOOTSTRAP_DELIVERY_ORIGIN).optional(),
    revision: Revision,
    requestId: z.uuid(),
    targets: z
      .array(z.enum(BOOTSTRAP_TARGETS))
      .min(1)
      .max(3)
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate bootstrap target",
      ),
    images: z.strictObject({
      woodpecker: Image,
      delivery: Image,
    }),
    controlPlane: BootstrapControlPlaneSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.targets.includes("delivery-control-plane") !==
      (value.controlPlane !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Control-plane bootstrap requires original qualified catalog selections only",
      });
    if (value.controlPlane !== undefined && value.deliveryUrl === undefined)
      context.addIssue({
        code: "custom",
        message:
          "Control-plane bootstrap requires its existing authenticated Delivery catalog",
      });
    for (const target of ["woodpecker", "delivery"] as const) {
      const image = value.images[target];
      const name =
        target === "woodpecker" ? "woodpecker-config-extension" : "delivery";
      if (
        (value.targets.includes(target) &&
          image.sourceRevision !== value.sourceRevision) ||
        image.repository !== `docker.io/shepherdjerred/${name}`
      )
        context.addIssue({
          code: "custom",
          message:
            "Bootstrap image must retain its exact reviewed source and fixed repository",
        });
    }
  });
export type BootstrapDescriptor = z.infer<typeof BootstrapDescriptorSchema>;
export function bootstrapTargetSelection(
  descriptor: BootstrapDescriptor,
  name: string,
) {
  if (name === "delivery-control-plane") {
    const selected = BootstrapControlPlaneSchema.parse(descriptor.controlPlane);
    return {
      revision: selected.chart.version,
      reference: `${selected.image.uri}:${selected.image.version}@${selected.image.digest}`,
    };
  }
  const image =
    descriptor.images[z.enum(["woodpecker", "delivery"]).parse(name)];
  return {
    revision: descriptor.revision,
    reference: `${image.repository}@${image.digest}`,
  };
}
export const BootstrapMetadataSchema = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  uid: z.string().min(1),
  resourceVersion: z.string().min(1),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
  finalizers: z.array(z.string()).default([]),
});
export const BootstrapApplicationSchema = z
  .object({
    apiVersion: z.string().default("argoproj.io/v1alpha1"),
    kind: z.literal("Application").default("Application"),
    metadata: BootstrapMetadataSchema,
    spec: z.record(z.string(), z.json()),
    operation: z.null().optional(),
    status: z.object({
      sync: z.object({
        status: z.enum(["Synced", "OutOfSync"]),
        revision: z.string(),
      }),
      health: z.object({ status: z.literal("Healthy") }),
      operationState: z
        .object({ phase: z.enum(["Succeeded", "Failed"]) })
        .loose()
        .optional(),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.status.operationState?.phase === "Failed" &&
      !bootstrapPriorRootTermination(value)
    )
      context.addIssue({
        code: "custom",
        message:
          "Failed operation lacks an exact verified root termination receipt",
      });
  });
export type BootstrapApplication = z.infer<typeof BootstrapApplicationSchema>;

export function bootstrapFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function assertBootstrapRootPaused(root: BootstrapApplication) {
  const policy = z
    .object({ automated: z.unknown().optional() })
    .optional()
    .parse(root.spec["syncPolicy"]);
  if (policy?.automated === undefined || policy.automated === null) return;
  z.object({ enabled: z.literal(false) }).parse(policy.automated);
}

/** This authority exists only before delegation; normal outages use the retained PG recovery commands. */
export function assertBootstrapOwnershipOff(
  applications: BootstrapApplication[],
): void {
  if (
    applications.some(
      (app) =>
        app.metadata.annotations["delivery.shepherdjerred.com/environment"] !==
        undefined,
    )
  )
    throw new Error("Native delegated Application prevents one-time bootstrap");
}

function manifestApplication(app: BootstrapApplication) {
  return {
    apiVersion: app.apiVersion,
    kind: app.kind,
    metadata: {
      name: app.metadata.name,
      ...(app.metadata.namespace === undefined
        ? {}
        : { namespace: app.metadata.namespace }),
      ...(Object.keys(app.metadata.labels).length === 0
        ? {}
        : { labels: app.metadata.labels }),
      annotations:
        app.metadata.name === "apps"
          ? Object.fromEntries(
              Object.entries(app.metadata.annotations).filter(
                ([key]) => key !== "ops.sjer.red/verified-root-release",
              ),
            )
          : app.metadata.annotations,
      ...(app.metadata.finalizers.length === 0
        ? {}
        : { finalizers: app.metadata.finalizers }),
    },
    spec: app.spec,
  };
}

/** Preserve native sources AND lifecycle in the actual archive, not a transient sync override. */
function selectedMetadata(
  metadata: Record<string, z.JSONType>,
  prior: BootstrapApplication | undefined,
) {
  if (prior !== undefined) return manifestApplication(prior).metadata;
  const selected = { ...metadata };
  if (selected["annotations"] !== undefined) {
    const annotations = z
      .record(z.string(), z.string())
      .parse(selected["annotations"]);
    delete annotations["delivery.shepherdjerred.com/environment"];
    selected["annotations"] = annotations;
  }
  return selected;
}

/** Captured native values are literal data, not executable Helm templates. */
export function bootstrapRootTemplate(manifest: string, chart: string): string {
  return chart === "apps" ? manifest.replaceAll("{{", "{{ `{{` }}") : manifest;
}

export function bootstrapRootManifest(
  raw: string,
  captured: BootstrapApplication[],
  descriptor: BootstrapDescriptor,
  priorRoot: string,
): string {
  assertBootstrapOwnershipOff(captured);
  const native = new Map(captured.map((app) => [app.metadata.name, app]));
  const selectedTargets = new Set<string>(descriptor.targets);
  const allowedTargets = new Set<string>(BOOTSTRAP_TARGETS);
  if (native.size !== captured.length)
    throw new Error("Duplicate native Application identity");
  const seen = new Set<string>();
  const inherited = parseAllDocuments(priorRoot).flatMap((doc) => {
    if (doc.errors.length > 0) throw new Error("Invalid prior root manifest");
    const value: unknown = doc.toJSON();
    return z.object({ kind: z.string() }).parse(value).kind === "Application"
      ? []
      : [value];
  });
  const documents = parseAllDocuments(raw).flatMap(
    (doc): Record<string, z.JSONType>[] => {
      if (doc.errors.length > 0)
        throw new Error("Invalid source root manifest");
      const value: unknown = doc.toJSON();
      const identity = z
        .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
        .parse(value);
      if (identity.kind !== "Application") return [];
      const name = identity.metadata.name;
      if (seen.has(name)) throw new Error("Duplicate root Application");
      seen.add(name);
      const prior = native.get(name);
      if (!selectedTargets.has(name)) {
        if (prior === undefined && allowedTargets.has(name)) return [];
        if (prior === undefined)
          throw new Error(
            `Bootstrap would create unrelated Application ${name}`,
          );
        return [manifestApplication(prior)];
      }
      const selected = z
        .object({
          apiVersion: z.string(),
          kind: z.literal("Application"),
          metadata: z.record(z.string(), z.json()),
          spec: z.record(z.string(), z.json()),
        })
        .parse(value);
      const source = z
        .object({
          repoURL: z.string(),
          chart: z.string(),
          targetRevision: z.string(),
        })
        .loose()
        .parse(selected.spec["source"]);
      if (
        source.chart !== name ||
        source.repoURL !== "https://chartmuseum.tailnet-1a49.ts.net"
      )
        throw new Error("Unexpected bootstrap chart definition");
      const selection = bootstrapTargetSelection(descriptor, name);
      const parameter =
        name === "delivery"
          ? "delivery.image"
          : "delivery.images.delivery-control-plane";
      return [
        {
          ...selected,
          metadata: selectedMetadata(selected.metadata, prior),
          spec: {
            ...selected.spec,
            source: {
              ...source,
              targetRevision: selection.revision,
              ...(name === "woodpecker"
                ? {}
                : {
                    helm: {
                      parameters: [
                        {
                          name: parameter,
                          value: selection.reference,
                          forceString: true,
                        },
                      ],
                    },
                  }),
            },
          },
        },
      ];
    },
  );
  for (const name of native.keys())
    if (!seen.has(name))
      throw new Error(`Bootstrap source would prune live Application ${name}`);
  for (const name of descriptor.targets)
    if (!seen.has(name))
      throw new Error(
        `Bootstrap source lacks ${name}; provision reviewed source registrations first`,
      );
  return [...inherited, ...documents]
    .map((doc) => stringify(doc, { compat: "yaml-1.1" }))
    .join("---\n");
}

/** Status updates may advance RV; semantic source/lifecycle and UID must stay exact. */
export function assertBootstrapSnapshot(
  captured: BootstrapApplication[],
  observed: BootstrapApplication[],
): void {
  assertBootstrapOwnershipOff(observed);
  const prior = captured.map((app) => ({
    uid: app.metadata.uid,
    ...manifestApplication(app),
  }));
  const current = observed.map((app) => ({
    uid: app.metadata.uid,
    ...manifestApplication(app),
  }));
  if (bootstrapFingerprint(prior) !== bootstrapFingerprint(current))
    throw new Error(
      "Native Application source, lifecycle, identity or inventory changed during bootstrap",
    );
}

export function bootstrapImageManifest(
  raw: string,
  target: (typeof BOOTSTRAP_TARGETS)[number],
  descriptor: BootstrapDescriptor,
): string {
  if (target !== "woodpecker") return raw;
  const image = descriptor.images.woodpecker;
  const reference = `${image.repository}:${image.version}@${image.digest}`;
  let count = 0;
  const replaced = raw.replaceAll(
    /docker\.io\/shepherdjerred\/woodpecker-config-extension(?::[\w.-]+)?@sha256:[a-f0-9]{64}/gu,
    () => {
      count++;
      return reference;
    },
  );
  if (count !== 2)
    throw new Error(
      "Woodpecker bootstrap must bind exactly its generator and CI_GATE_IMAGE",
    );
  return replaced;
}
