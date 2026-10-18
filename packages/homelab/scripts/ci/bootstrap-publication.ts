import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  discoverChartInputs,
  releasePrunesChart,
} from "#scripts/helm/helm-release-core.ts";
import { stageChart } from "#scripts/helm/helm-push.ts";
import { bootstrapArgo } from "./bootstrap-native.ts";
import { bindChartImageDependencies } from "#scripts/helm/helm-delivery-publication.ts";
import { publicationImageDigests } from "#cdk8s/src/release-configuration.ts";
import {
  bootstrapRootManifest,
  bootstrapRootTemplate,
  bootstrapImageManifest,
  bootstrapFingerprint,
  bootstrapTargetSelection,
  type BootstrapDescriptor,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";

const CHART_ORIGIN = "https://chartmuseum.tailnet-1a49.ts.net";
type Captured = {
  root: BootstrapApplication;
  applications: BootstrapApplication[];
  priorRoot: string;
};

function maintenanceImage(manifests: unknown[]) {
  const deployments = manifests.filter((value) => {
    const identity = z
      .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
      .parse(value);
    return (
      identity.kind === "Deployment" &&
      identity.metadata.name === "temporal-maintenance-worker"
    );
  });
  const image = z
    .string()
    .regex(
      /^docker\.io\/shepherdjerred\/temporal-worker(?::2\.0\.0-\d+)?@sha256:[a-f0-9]{64}$/u,
    );
  const container = (name: string) =>
    z.object({ name: z.literal(name), image });
  const [original] = z
    .tuple([
      z.object({
        metadata: z.object({ namespace: z.literal("woodpecker-ci") }),
        spec: z.object({
          template: z.object({
            metadata: z.object({
              labels: z.object({
                app: z.literal("temporal-maintenance-worker"),
                component: z.literal("maintenance-worker"),
              }),
            }),
            spec: z.object({
              containers: z.tuple([container("temporal-maintenance-worker")]),
              initContainers: z.tuple([container("copy-kometa-config")]),
            }),
          }),
        }),
      }),
    ])
    .parse(deployments);
  const selected = original.spec.template.spec.containers[0].image;
  if (selected !== original.spec.template.spec.initContainers[0].image)
    throw new Error(
      "Original Woodpecker maintenance init/runtime image differs",
    );
  return selected;
}

/** Retain the exact immutable original; replacing the generator is not a maintenance-worker release. */
export async function bootstrapMaintenanceImage(
  prior: BootstrapApplication,
  read = bootstrapArgo,
) {
  z.object({
    metadata: z.object({ name: z.literal("woodpecker") }),
    spec: z.object({
      source: z.object({
        repoURL: z.literal(CHART_ORIGIN),
        chart: z.literal("woodpecker"),
      }),
    }),
  }).parse(prior);
  const result = z
    .object({ manifests: z.array(z.string()) })
    .parse(
      await read(
        `/woodpecker/manifests?revision=${encodeURIComponent(prior.status.sync.revision)}`,
      ),
    );
  return maintenanceImage(
    result.manifests.map((raw) => JSON.parse(raw) as unknown),
  );
}

export function preserveBootstrapMaintenanceImage(
  raw: string,
  original: string,
) {
  const current = maintenanceImage(
    parseAllDocuments(raw).map((doc): unknown => {
      if (doc.errors.length > 0)
        throw new Error("Invalid Woodpecker bootstrap manifest");
      const value: unknown = doc.toJSON();
      return value;
    }),
  );
  let count = 0;
  const preserved = raw.replaceAll(current, () => {
    count++;
    return original;
  });
  if (count !== 2)
    throw new Error(
      "Woodpecker bootstrap must preserve exactly its original maintenance init/runtime images",
    );
  return preserved;
}

function prepareBootstrapManifest(
  raw: string,
  name: string,
  input: {
    descriptor: BootstrapDescriptor;
    captured: Captured;
    maintenance: string | undefined;
  },
) {
  if (name === "apps")
    return bootstrapRootManifest(
      raw,
      [input.captured.root, ...input.captured.applications],
      input.descriptor,
      input.captured.priorRoot,
    );
  const selected = bootstrapImageManifest(
    raw,
    z.enum(["woodpecker", "delivery", "delivery-control-plane"]).parse(name),
    input.descriptor,
  );
  return name === "woodpecker"
    ? preserveBootstrapMaintenanceImage(
        selected,
        z.string().parse(input.maintenance),
      )
    : selected;
}

async function capturedMaintenanceImage(
  descriptor: BootstrapDescriptor,
  captured: Captured,
) {
  if (!descriptor.targets.includes("woodpecker")) return;
  const prior = captured.applications.find(
    (app) => app.metadata.name === "woodpecker",
  );
  if (prior === undefined)
    throw new Error("Woodpecker bootstrap requires its original Application");
  return bootstrapMaintenanceImage(prior);
}
export function bootstrapArchiveNames(descriptor: BootstrapDescriptor) {
  return [
    ...descriptor.targets.filter(
      (target) => target !== "delivery-control-plane",
    ),
    "apps",
  ];
}
export async function prepareBootstrapArchives(
  descriptor: BootstrapDescriptor,
  captured: Captured,
  directory: string,
) {
  const homelab = new URL("../../", import.meta.url).pathname;
  const maintenance = await capturedMaintenanceImage(descriptor, captured);
  const images = {
    ...publicationImageDigests(),
    "shepherdjerred/delivery": descriptor.images.delivery.digest,
    "shepherdjerred/woodpecker-config-extension":
      descriptor.images.woodpecker.digest,
  };
  await run(["bun", "--no-install", "run", "build"], {
    cwd: path.join(homelab, "src/cdk8s"),
    env: {
      HOMELAB_IMAGE_DIGESTS_JSON: JSON.stringify(images),
    },
    unsetEnv: [
      "HOMELAB_CHART_REVISIONS_JSON",
      "OP_SERVICE_ACCOUNT_TOKEN",
      "ARGOCD_TOKEN",
      "CHARTMUSEUM_PASSWORD",
      "CHARTMUSEUM_USERNAME",
    ],
  });
  const inputs = await discoverChartInputs(
    path.join(homelab, "src/cdk8s/helm"),
    path.join(homelab, "src/cdk8s/dist"),
  );
  const archives = [];
  let rootManifest = "";
  for (const name of bootstrapArchiveNames(descriptor)) {
    const input = inputs.find((candidate) => candidate.name === name);
    if (input === undefined)
      throw new Error(`Bootstrap source does not build ${name}`);
    const original = bindChartImageDependencies(
      await Bun.file(input.manifestPath).text(),
      images,
    );
    const prepared = prepareBootstrapManifest(original, name, {
      descriptor,
      captured,
      maintenance,
    });
    const manifestPath = path.join(directory, `${name}.yaml`);
    await Bun.write(manifestPath, bootstrapRootTemplate(prepared, name), {
      mode: 0o600,
    });
    const staging = path.join(directory, name);
    await mkdir(staging, { mode: 0o700 });
    const archive = await stageChart(
      { ...input, manifestPath },
      descriptor.revision,
      staging,
    );
    const digest = `sha256:${new Bun.CryptoHasher("sha256").update(await Bun.file(archive).arrayBuffer()).digest("hex")}`;
    archives.push({
      name,
      revision: descriptor.revision,
      uri: `${CHART_ORIGIN}/charts/${name}-${descriptor.revision}.tgz`,
      digest,
      archive,
      sourceManifestFingerprint: bootstrapFingerprint(original),
    });
    if (name === "apps") rootManifest = prepared;
  }
  const expected = [
    { name: "apps", revision: descriptor.revision, prune: false },
  ];
  const selectedTargets = new Set<string>(descriptor.targets);
  for (const doc of parseAllDocuments(rootManifest)) {
    const identity = z
      .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
      .parse(doc.toJSON());
    if (identity.kind !== "Application" || identity.metadata.name === "apps")
      continue;
    const source = z
      .object({
        spec: z.object({
          source: z.object({
            repoURL: z.string(),
            chart: z.string().optional(),
          }),
        }),
      })
      .parse(doc.toJSON()).spec.source;
    if (
      ![CHART_ORIGIN, "https://chartmuseum.sjer.red"].includes(
        source.repoURL,
      ) ||
      source.chart === undefined
    )
      continue;
    const prior = captured.applications.find(
      (app) => app.metadata.name === identity.metadata.name,
    );
    const revision = selectedTargets.has(identity.metadata.name)
      ? bootstrapTargetSelection(descriptor, identity.metadata.name).revision
      : prior?.status.sync.revision;
    expected.push({
      name: identity.metadata.name,
      revision: z
        .string()
        .regex(/^2\.0\.0-\d+$/u)
        .parse(revision),
      prune: releasePrunesChart(source.chart),
    });
  }
  return { archives, expected };
}

/** Immutable compare-before-upload also repairs a lost publication response without replacing bytes. */
export async function publishBootstrapArchive(artifact: {
  uri: string;
  digest: string;
  archive: string;
}) {
  const inspect = async () => {
    const response = await fetch(artifact.uri, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (response.status === 404) return false;
    if (!response.ok)
      throw new Error(
        `Bootstrap archive inspection failed HTTP ${String(response.status)}`,
      );
    const digest = `sha256:${new Bun.CryptoHasher("sha256").update(await response.arrayBuffer()).digest("hex")}`;
    if (digest !== artifact.digest)
      throw new Error(
        "Bootstrap archive revision already contains different immutable bytes",
      );
    return true;
  };
  if (await inspect()) return;
  const username = z.string().min(1).parse(Bun.env["CHARTMUSEUM_USERNAME"]),
    password = z.string().min(1).parse(Bun.env["CHARTMUSEUM_PASSWORD"]);
  let posted = false;
  try {
    const response = await fetch(`${CHART_ORIGIN}/api/charts`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
        "content-type": "application/octet-stream",
      },
      body: Bun.file(artifact.archive),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    posted = response.ok;
  } catch {
    // The POST may have succeeded. Only independent exact-byte readback can settle ambiguity.
  }
  if (!(await inspect()))
    throw new Error(
      posted
        ? "Published bootstrap archive failed exact-byte readback"
        : "Bootstrap archive publication unresolved; retain the receipt and inspect before repeating",
    );
}
