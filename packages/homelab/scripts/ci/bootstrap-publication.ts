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
import {
  bootstrapRootManifest,
  bootstrapImageManifest,
  bootstrapFingerprint,
  bootstrapTargetSelection,
  type BootstrapDescriptor,
  type BootstrapApplication,
} from "./bootstrap-selection.ts";

const CHART_ORIGIN = "https://chartmuseum.tailnet-1a49.ts.net";
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
  captured: {
    root: BootstrapApplication;
    applications: BootstrapApplication[];
    priorRoot: string;
  },
  directory: string,
) {
  const homelab = new URL("../../", import.meta.url).pathname;
  await run(["bun", "--no-install", "run", "build"], {
    cwd: path.join(homelab, "src/cdk8s"),
    env: {
      HOMELAB_IMAGE_DIGESTS_JSON: JSON.stringify({
        "shepherdjerred/delivery": descriptor.images.delivery.digest,
      }),
      HOMELAB_RELEASE_VERSION: descriptor.images.delivery.version,
    },
    unsetEnv: [
      "HOMELAB_VERSION_CATALOG_JSON",
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
    const original = await Bun.file(input.manifestPath).text();
    const prepared =
      name === "apps"
        ? bootstrapRootManifest(
            original,
            [captured.root, ...captured.applications],
            descriptor,
            captured.priorRoot,
          )
        : bootstrapImageManifest(
            original,
            z
              .enum(["woodpecker", "delivery", "delivery-control-plane"])
              .parse(name),
            descriptor,
          );
    const manifestPath = path.join(directory, `${name}.yaml`);
    await Bun.write(manifestPath, prepared, { mode: 0o600 });
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
