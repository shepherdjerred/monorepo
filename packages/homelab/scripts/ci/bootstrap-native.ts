import { z } from "zod";
import { stringify } from "yaml";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  BootstrapApplicationSchema,
  BOOTSTRAP_TARGETS,
  assertBootstrapSnapshot,
  BOOTSTRAP_DELIVERY_ORIGIN,
  assertBootstrapOwnershipOff,
  type BootstrapDescriptor,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";
import { assertBootstrapMaintenance } from "./bootstrap-maintenance.ts";
import {
  assertBootstrapImageSource,
  assertBootstrapControlPlaneImage,
} from "./bootstrap-image-proof.ts";
import { isVerifiedRootReleaseTermination } from "@shepherdjerred/ops-model/argocd-release-receipt.ts";
import { SourceProofSchema } from "@shepherdjerred/ops-model/ci-source-proof.ts";

const ORIGIN = "https://argocd.sjer.red";
const ApplicationIdentity = z.object({
  metadata: z.object({
    name: z.string(),
    labels: z.record(z.string(), z.string()).default({}),
    annotations: z.record(z.string(), z.string()).default({}),
  }),
});
function nativeIdentity(raw: unknown) {
  const identity = ApplicationIdentity.parse(raw);
  if (
    identity.metadata.annotations["delivery.shepherdjerred.com/environment"] !==
    undefined
  )
    throw new Error(
      "Live Delivery-owned Application prevents one-time bootstrap",
    );
  return identity;
}
function rootOwned(identity: z.infer<typeof ApplicationIdentity>) {
  return (
    identity.metadata.labels["argocd.argoproj.io/instance"] === "apps" ||
    identity.metadata.annotations["argocd.argoproj.io/tracking-id"]?.startsWith(
      "apps:argoproj.io/Application:",
    ) === true
  );
}

/** Existing Delivery must independently prove its catalog empty; an unreachable API never means unowned. */
export async function assertBootstrapRegistryEmpty(
  applications: BootstrapApplication[],
  deliveryUrl: string | undefined,
  inspect = async (url: string): Promise<unknown> => {
    const result = await run(
      ["toolkit", "deploy", "inventory", "--machine", "--url", url, "--json"],
      { capture: true, echoCapturedStdout: false },
    );
    return JSON.parse(result.stdout);
  },
) {
  assertBootstrapOwnershipOff(applications);
  if (!applications.some((app) => app.metadata.name === "delivery")) return;
  if (deliveryUrl === undefined)
    throw new Error(
      "Existing Delivery requires its authenticated catalog URL before bootstrap",
    );
  z.literal(BOOTSTRAP_DELIVERY_ORIGIN).parse(deliveryUrl);
  const environments = z
    .array(z.object({ id: z.string() }))
    .parse(await inspect(deliveryUrl));
  if (environments.length > 0)
    throw new Error(
      "Registered PostgreSQL environments prevent one-time bootstrap",
    );
}
export async function bootstrapArgo(path: string) {
  const token = Bun.env["ARGOCD_TOKEN"];
  if (token === undefined || token.length === 0)
    throw new Error("Bootstrap requires the existing operator Argo credential");
  const response = await fetch(new URL(`/api/v1/applications${path}`, ORIGIN), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `Bootstrap Argo inspection failed HTTP ${String(response.status)}`,
    );
  const value: unknown = await response.json();
  return value;
}

export async function captureBootstrapApplications() {
  const rawRoot = await bootstrapArgo("/apps");
  const root = BootstrapApplicationSchema.parse(rawRoot);
  const rendered = z
    .object({ manifests: z.array(z.string()) })
    .parse(
      await bootstrapArgo(
        `/apps/manifests?revision=${encodeURIComponent(root.status.sync.revision)}`,
      ),
    );
  const rootNames = new Set(
    rendered.manifests.flatMap((raw) => {
      const item = z
        .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
        .parse(JSON.parse(raw));
      return item.kind === "Application" ? [item.metadata.name] : [];
    }),
  );
  const listed = z
    .object({ items: z.array(z.unknown()) })
    .parse(await bootstrapArgo(""));
  const captured: BootstrapApplication[] = [];
  for (const raw of listed.items) {
    const identity = nativeIdentity(raw);
    if (identity.metadata.name === "apps") continue;
    if (
      new Set<string>(BOOTSTRAP_TARGETS).has(identity.metadata.name) &&
      !rootNames.has(identity.metadata.name) &&
      !rootOwned(identity)
    )
      throw new Error(
        "Bootstrap target exists outside the captured root ownership",
      );
    if (rootNames.has(identity.metadata.name) || rootOwned(identity))
      captured.push(BootstrapApplicationSchema.parse(raw));
  }
  if (
    captured.length === 0 ||
    [...rootNames].some(
      (name) =>
        name !== "apps" && !captured.some((app) => app.metadata.name === name),
    )
  )
    throw new Error("Native root Application inventory is incomplete");
  if (captured.some((app) => app.status.sync.status !== "Synced"))
    throw new Error(
      "Initial bootstrap requires every current root-owned Application Synced/Healthy",
    );
  assertBootstrapMaintenance(rawRoot, [root, ...captured], rendered.manifests);
  return {
    root,
    applications: captured.toSorted((a, b) =>
      a.metadata.name.localeCompare(b.metadata.name),
    ),
    priorRoot: rendered.manifests
      .map((raw) => stringify(JSON.parse(raw)))
      .join("---\n"),
  };
}

export async function rereadBootstrapApplications(
  captured: BootstrapApplication[],
) {
  const listed = z
    .object({ items: z.array(z.unknown()) })
    .parse(await bootstrapArgo(""));
  const names = new Set(captured.map((app) => app.metadata.name));
  return listed.items
    .flatMap((raw) => {
      const identity = nativeIdentity(raw);
      const owned = rootOwned(identity);
      return identity.metadata.name !== "apps" &&
        (owned || names.has(identity.metadata.name))
        ? [BootstrapApplicationSchema.parse(raw)]
        : [];
    })
    .toSorted((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

export async function bootstrapSourceCas(
  prior: BootstrapApplication,
  source: unknown,
) {
  z.enum([...BOOTSTRAP_TARGETS, "argocd"]).parse(prior.metadata.name);
  assertBootstrapOwnershipOff([prior]);
  const current = BootstrapApplicationSchema.parse(
    await bootstrapArgo(`/${encodeURIComponent(prior.metadata.name)}`),
  );
  assertBootstrapOwnershipOff([current]);
  assertBootstrapSnapshot([prior], [current]);
  const token = z.string().min(1).parse(Bun.env["ARGOCD_TOKEN"]);
  const selected = z.record(z.string(), z.json()).parse(source);
  const patch = [
    { op: "test", path: "/metadata/uid", value: prior.metadata.uid },
    {
      op: "test",
      path: "/metadata/resourceVersion",
      value: current.metadata.resourceVersion,
    },
    { op: "test", path: "/spec/source", value: prior.spec["source"] },
    { op: "replace", path: "/spec/source", value: selected },
  ];
  const response = await fetch(
    new URL(
      `/api/v1/applications/${encodeURIComponent(prior.metadata.name)}`,
      ORIGIN,
    ),
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ patch: JSON.stringify(patch), patchType: "json" }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(
      "Bootstrap source CAS response is unresolved; inspect the retained receipt before continuing",
    );
  return BootstrapApplicationSchema.parse(await response.json());
}

export async function captureParentArchive(root: BootstrapApplication) {
  const source = z
    .object({
      repoURL: z.enum([
        "https://chartmuseum.sjer.red",
        "https://chartmuseum.tailnet-1a49.ts.net",
      ]),
      chart: z.literal("apps"),
    })
    .parse(root.spec["source"]);
  const uri = `${source.repoURL}/charts/apps-${root.status.sync.revision}.tgz`;
  const metadata = await fetch(
    `${source.repoURL}/api/charts/apps/${encodeURIComponent(root.status.sync.revision)}`,
    { signal: AbortSignal.timeout(30_000), redirect: "error" },
  );
  if (!metadata.ok)
    throw new Error(
      "Cannot independently inspect the prior root archive metadata",
    );
  const parsed = z
    .object({ digest: z.string().regex(/^[a-f0-9]{64}$/u) })
    .parse(await metadata.json());
  const response = await fetch(uri, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Cannot read the original root archive");
  const bytes = await response.arrayBuffer();
  if (
    bytes.byteLength > 32 * 1024 * 1024 ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== parsed.digest
  )
    throw new Error("Prior root archive digest or size differs");
  return {
    uri,
    digest: `sha256:${parsed.digest}`,
    revision: root.status.sync.revision,
  };
}

export async function bootstrapSourceProof(
  descriptor: Pick<BootstrapDescriptor, "sourceRevision" | "pullRequest">,
) {
  const result = await run(
    [
      "toolkit",
      "ci",
      "source-proof",
      String(descriptor.pullRequest),
      "--source",
      descriptor.sourceRevision,
      "--json",
    ],
    { capture: true, echoCapturedStdout: false },
  );
  const raw: unknown = JSON.parse(result.stdout);
  return parseBootstrapSourceProof(raw, descriptor);
}

export function parseBootstrapSourceProof(
  raw: unknown,
  descriptor: Pick<BootstrapDescriptor, "sourceRevision" | "pullRequest">,
) {
  const proof = SourceProofSchema.parse(raw);
  if (
    proof.sourceRevision !== descriptor.sourceRevision ||
    proof.pullRequest !== descriptor.pullRequest
  )
    throw new Error(
      "Bootstrap source proof differs from the requested reviewed PR head",
    );
  if (Date.parse(proof.verifiedAt) < Date.now() - 60_000)
    throw new Error("Bootstrap source proof is stale");
  return proof;
}

export async function assertBootstrapCheckout(source: string) {
  const head = await run(["git", "rev-parse", "HEAD"], {
    capture: true,
    echoCapturedStdout: false,
  });
  const status = await run(["git", "status", "--porcelain"], {
    capture: true,
    echoCapturedStdout: false,
  });
  if (head.stdout.trim() !== source || status.stdout.trim().length > 0)
    throw new Error(
      "Bootstrap requires a clean checkout of the exact independently reviewed source",
    );
}

export async function verifyBootstrapImages(descriptor: BootstrapDescriptor) {
  const images = [
    ...Object.values(descriptor.images),
    ...(descriptor.controlPlane === undefined
      ? []
      : [
          {
            ...descriptor.controlPlane.image,
            repository: descriptor.controlPlane.image.uri,
          },
        ]),
  ];
  for (const image of images) {
    const result = await run(
      [
        "docker",
        "buildx",
        "imagetools",
        "inspect",
        `${image.repository}@${image.digest}`,
        "--format",
        "{{json .Image}}",
      ],
      { capture: true, echoCapturedStdout: false },
    );
    const configurations: unknown = JSON.parse(result.stdout);
    assertBootstrapImageSource(
      configurations,
      image.sourceRevision,
      image.version,
    );
    if (image.repository === descriptor.controlPlane?.image.uri)
      assertBootstrapControlPlaneImage(configurations);
  }
}

export function bootstrapOperationReceipt(raw: unknown, requestId: string) {
  const app = z
    .object({
      metadata: z.object({ name: z.string(), uid: z.string() }),
      status: z.object({
        operationState: z.object({
          phase: z.enum(["Succeeded", "Failed"]),
          finishedAt: z.iso.datetime({ offset: true }),
          operation: z.object({
            info: z.array(z.object({ name: z.string(), value: z.string() })),
          }),
        }),
      }),
    })
    .parse(raw);
  if (
    app.status.operationState.phase === "Failed" &&
    !isVerifiedRootReleaseTermination(raw)
  )
    throw new Error(
      "Bootstrap root did not finish with its exact verified termination receipt",
    );
  const info = app.status.operationState.operation.info;
  if (
    info.find((entry) => entry.name === "ci.sjer.red/request-id")?.value !==
    requestId
  )
    throw new Error("Bootstrap operation receipt belongs to another request");
  return {
    application: app.metadata.name,
    applicationUid: app.metadata.uid,
    requestId,
    operationId: z
      .uuid()
      .parse(
        info.find((entry) => entry.name === "ci.sjer.red/operation-id")?.value,
      ),
    finishedAt: app.status.operationState.finishedAt,
  };
}
