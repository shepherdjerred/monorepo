import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { ArgoResourceSchema } from "./argocd-proof.ts";
import { collectAuditConsumption } from "homelab/src/cdk8s/scripts/onepassword/audit-consumption.ts";
import { requireRenderedSource } from "./model/application-proof.ts";
import type { RenderedApplication } from "./model/application.ts";
import { proveMediaIngressPrunes } from "./media-ingress-prune.ts";
import {
  mediaIngressSourceHash,
  type MediaIngressPruning,
} from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";
import {
  ManagedResourcesSchema,
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";
import {
  renderedTargetState,
  resourceIdentity,
  type RenderedTarget,
} from "homelab/scripts/argocd/argocd-rendered-targets.ts";

const VAULT = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/";
type Scope = {
  namespace: string;
  environment: string;
  bindingNamespace: string;
  retired: string;
  item: string;
  replacements: readonly { name: string; itemId: string }[];
};
const SCOPES: Readonly<Record<string, Scope>> = {
  media: {
    namespace: "media",
    environment: "streambot/prod",
    bindingNamespace: "media",
    retired: "recyclarr-config-homelab",
    item: "fu5ufvg6bx3kkcp7lqi5pmwj2a",
    replacements: [
      {
        name: "recyclarr-radarr-credential",
        itemId: "tvy75zdvgyajf57rvzywc7nqbu",
      },
      {
        name: "recyclarr-sonarr-credential",
        itemId: "ou5byilomqmlx7askklqonyxfi",
      },
    ],
  },
  woodpecker: {
    namespace: "woodpecker",
    environment: "woodpecker/prod",
    bindingNamespace: "woodpecker-ci",
    retired: "ci-chartmuseum-credentials",
    item: "cnutkdwa7uka5hk3wx5gimyfom",
    replacements: [
      {
        name: "ci-chartmuseum-basic-auth",
        itemId: "wwoism5fsvmbisv4ef47yxqy2i",
      },
    ],
  },
  "delivery-control-plane": {
    namespace: "temporal",
    environment: "delivery-control-plane/prod",
    bindingNamespace: "delivery-platform-jobs",
    retired: "discord-minecraft-credentials",
    item: "q37vet77dfggoqbvu4bqle3gje",
    replacements: [
      {
        name: "discord-minecraft-tsmc-credentials",
        itemId: "yqp25gif2grm5gkg6l44e6vmxy",
      },
    ],
  },
};
const Resource = ArgoResourceSchema.extend({
  metadata: ArgoResourceSchema.shape.metadata.extend({
    uid: z.string().optional(),
    finalizers: z.array(z.string()).optional(),
    ownerReferences: z.array(z.unknown()).optional(),
  }),
}).loose();
const Binding = Resource.extend({
  apiVersion: z.literal("onepassword.com/v1"),
  kind: z.literal("OnePasswordItem"),
  spec: z.object({ itemPath: z.string() }),
});
type Selection = Pick<
  RenderedApplication,
  "name" | "environmentId" | "revision" | "source"
> & {
  namespace: string | undefined;
};

function group(version: string) {
  return version.includes("/") ? version.slice(0, version.indexOf("/")) : "";
}

function assertRetirable(metadata: z.infer<typeof Binding>["metadata"]) {
  if (
    metadata.deletionTimestamp !== undefined ||
    (metadata.ownerReferences?.length ?? 0) !== 0 ||
    metadata.finalizers?.some(
      (value) => value !== "onepassword.com/finalizer.secret",
    ) === true ||
    metadata.annotations?.["argocd.argoproj.io/hook"] !== undefined ||
    metadata.annotations?.["argocd.argoproj.io/sync-options"]
      ?.split(",")
      .map((value) => value.trim())
      .includes("Prune=false") === true
  )
    throw new Error(
      "Retired credential binding is not the exact owned resource",
    );
}

function assertOwnedBinding(
  raw: unknown,
  cached: unknown,
  context: {
    resource: ManagedResource;
    application: string;
    item: string;
    seen: Set<string>;
  },
) {
  const { resource, application, item, seen } = context;
  const native = Binding.parse(raw);
  const previous = Binding.parse(cached);
  const metadata = native.metadata;
  assertRetirable(metadata);
  const uid = metadata.uid;
  if (
    uid === undefined ||
    uid === "" ||
    uid !== previous.metadata.uid ||
    seen.has(uid) ||
    metadata.name !== resource.name ||
    metadata.namespace !== resource.namespace ||
    previous.metadata.name !== metadata.name ||
    previous.metadata.namespace !== metadata.namespace ||
    metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `${application}:onepassword.com/OnePasswordItem:${resource.namespace ?? ""}/${resource.name}` ||
    native.spec.itemPath !== VAULT + item ||
    previous.spec.itemPath !== native.spec.itemPath
  )
    throw new Error(
      "Retired credential binding is not the exact owned resource",
    );
  seen.add(uid);
}

function assertCanonicalBindings(
  desired: readonly unknown[],
  scope: Scope,
  namespace: string | undefined,
) {
  for (const { name, itemId } of scope.replacements) {
    const matches = desired.filter((raw) => {
      const binding = Binding.safeParse(raw);
      return (
        binding.success &&
        binding.data.metadata.name === name &&
        (binding.data.metadata.namespace ?? namespace) ===
          scope.bindingNamespace &&
        binding.data.spec.itemPath === VAULT + itemId
      );
    });
    if (matches.length !== 1)
      throw new Error(
        "Frozen chart lacks the exact canonical credential binding",
      );
  }
}

function renderedInventory(manifests: readonly string[]) {
  const desired: z.infer<typeof Resource>[] = [];
  const targets = new Map<string, RenderedTarget[]>();
  for (const manifest of manifests) {
    const resource = Resource.parse(JSON.parse(manifest));
    desired.push(resource);
    const apiGroup = group(resource.apiVersion);
    const identity = resourceIdentity(
      apiGroup,
      resource.kind,
      resource.metadata.name,
    );
    targets.set(identity, [
      ...(targets.get(identity) ?? []),
      {
        apiVersion: resource.apiVersion,
        group: apiGroup,
        kind: resource.kind,
        name: resource.metadata.name,
        namespace: resource.metadata.namespace,
        manifest,
      },
    ]);
  }
  return { desired, targets };
}

type ArgoRead = (path: string) => Promise<unknown>;

async function readNativeResource(
  app: string,
  resource: ManagedResource,
  version: string,
  read: ArgoRead,
): Promise<unknown> {
  const query = new URLSearchParams({
    namespace: resource.namespace ?? "",
    resourceName: resource.name,
    group: resource.group ?? "",
    version,
    kind: resource.kind,
  });
  const { manifest } = z
    .object({ manifest: z.string() })
    .parse(await read(`${app}/resource?${query.toString()}`));
  return JSON.parse(manifest) as unknown;
}

async function assertCredentialPrunes(input: {
  app: string;
  scope: Scope;
  namespace: string | undefined;
  desired: readonly unknown[];
  obsolete: readonly ManagedResource[];
  read: ArgoRead;
}) {
  const { app, scope, namespace, desired, obsolete, read } = input;
  const consumers = new Map<string, Set<string>>();
  collectAuditConsumption(desired, consumers);
  if (consumers.has(scope.retired))
    throw new Error("Frozen chart still consumes the retired credential");
  assertCanonicalBindings(desired, scope, namespace);
  const seen = new Set<string>();
  for (const resource of obsolete) {
    if (
      resource.group !== "onepassword.com" ||
      resource.kind !== "OnePasswordItem" ||
      resource.namespace !== scope.bindingNamespace ||
      resource.name !== scope.retired
    )
      throw new Error("Credential sync refuses unrelated or storage pruning");
    assertOwnedBinding(
      await readNativeResource(app, resource, "v1", read),
      parseObject(resource.liveState, resource, "liveState"),
      { resource, application: app, item: scope.item, seen },
    );
  }
}

/** Authorize only the reviewed credential or Media ingress retirements. */
export async function credentialSyncPrunes(
  selection: Selection,
  read: ArgoRead,
): Promise<boolean | MediaIngressPruning> {
  const scope = SCOPES[selection.name];
  if (scope === undefined) return false;
  if (
    selection.source.chart !== selection.name ||
    selection.namespace !== scope.namespace ||
    selection.environmentId !== scope.environment
  )
    throw new Error("Credential pruning requires its exact registered scope");
  const app = encodeURIComponent(selection.name);
  const before = await read(`${app}?refresh=hard`);
  const frozen = requireRenderedSource(before, selection);
  if (
    z.object({ namespace: z.string() }).parse(frozen.spec["destination"])
      .namespace !== scope.namespace
  )
    throw new Error(
      "Credential Application destination differs from its registered scope",
    );
  if (
    ["Running", "Terminating"].includes(
      frozen.status.operationState?.phase ?? "",
    )
  )
    throw new Error(
      "Credential pruning requires a settled Application operation",
    );
  const manifests = z
    .object({ manifests: z.array(z.string()) })
    .parse(
      await read(
        `${app}/manifests?revision=${encodeURIComponent(selection.revision)}`,
      ),
    ).manifests;
  const { desired, targets } = renderedInventory(manifests);
  const managed = ManagedResourcesSchema.parse(
    await read(`${app}/managed-resources`),
  ).items;
  const obsolete = managed.filter(
    (resource) =>
      parseObject(resource.liveState, resource, "liveState") !== null &&
      renderedTargetState(targets, resource, selection.name, managed) ===
        undefined,
  );
  if (obsolete.length === 0) return false;
  const mediaIngressRetirement =
    selection.name === "media" &&
    obsolete.some(({ kind }) => kind === "Ingress");
  let mediaIngressPrunes: MediaIngressPruning | undefined;
  if (mediaIngressRetirement) {
    assertIdleMediaApplication(frozen);
    const resources = await proveMediaIngressPrunes({
      desired,
      obsolete,
      readNative: (resource) => readNativeResource(app, resource, "v1", read),
    });
    mediaIngressPrunes = {
      applicationUid: frozen.metadata.uid,
      sourceHash: mediaIngressSourceHash(selection.source),
      resources,
    };
  } else {
    await assertCredentialPrunes({
      app,
      scope,
      namespace: selection.namespace,
      desired,
      obsolete,
      read,
    });
  }
  const after = await read(app);
  const settled = requireRenderedSource(after, selection);
  if (mediaIngressRetirement) assertIdleMediaApplication(settled);
  if (
    settled.metadata.uid !== frozen.metadata.uid ||
    canonicalJson(settled.spec) !== canonicalJson(frozen.spec)
  )
    throw new Error("Credential source or Application changed before sync");
  return mediaIngressPrunes ?? true;
}

function assertIdleMediaApplication(
  app: ReturnType<typeof requireRenderedSource>,
) {
  const phase = app.status.operationState?.phase;
  if (phase === "Running" || phase === "Terminating" || app.operation != null)
    throw new Error(
      "Media ingress pruning requires a settled Application operation",
    );
}
