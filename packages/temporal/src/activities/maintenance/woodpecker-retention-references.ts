import { z } from "zod/v4";
import type { RetentionRepo } from "#shared/woodpecker-retention.ts";
import type { RetentionRequest } from "./woodpecker-retention-client.ts";
import { RetentionPipelineSchema } from "#shared/woodpecker-retention.ts";

const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const PullRequestsSchema = z.array(
  z.object({ head: z.object({ sha: ShaSchema }) }),
);
const ContainersSchema = z.array(z.object({ image: z.string().min(1) }));
const PodSpecSchema = z.object({
  containers: ContainersSchema,
  initContainers: ContainersSchema.optional(),
});
const PodSchema = z.object({ spec: PodSpecSchema });
const DeploymentSchema = z.object({ spec: z.object({ template: PodSchema }) });
const ApplicationSchema = z.object({
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    source: z
      .object({ repoURL: z.string(), targetRevision: z.string() })
      .optional(),
  }),
  status: z
    .object({ sync: z.object({ revision: z.string().optional() }).optional() })
    .optional(),
});
const ListSchema = z.object({
  metadata: z.object({ continue: z.string().optional() }),
  items: z.array(z.unknown()),
});

/** CI publisher offsets Woodpecker numbers by 1,000,000 (pipeline/emit.ts). */
export function artifactPipelineNumber(version: string): number | undefined {
  const match = /^2\.0\.0-(\d+)(?:@sha256:[a-f0-9]{64})?$/.exec(version);
  if (match === null) return undefined;
  const number = Number(match[1]) - 1_000_000;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

type ArtifactInventory = { numbers: Set<number>; reasons: Set<string> };

function applicationRepositoryHost(identifier: string): string | undefined {
  if (
    identifier === "" ||
    /[\s\\]/.test(identifier) ||
    /^(?:https?|oci|ssh|git):(?!\/\/)/i.test(identifier)
  )
    return undefined;
  // Argo Helm OCI identifiers may be registry/path without a URL scheme.
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(identifier)
    ? identifier
    : `https://${identifier}`;
  if (!URL.canParse(normalized)) return undefined;
  const url = new URL(normalized);
  return ["http:", "https:", "oci:", "ssh:", "git:"].includes(url.protocol) &&
    url.hostname !== ""
    ? url.hostname.toLowerCase()
    : undefined;
}

function addArtifact(
  version: string,
  inventory: ArtifactInventory,
  label: string,
) {
  const number = artifactPipelineNumber(version);
  if (
    number === undefined &&
    /^2\.0\.0-[1-9]\d{0,5}(?:@sha256:[a-f0-9]{64})?$/.test(version)
  )
    return;
  if (number === undefined) {
    inventory.reasons.add(`Unresolved ${label} version: ${version}`);
  } else inventory.numbers.add(number);
}

function observeApplication(raw: unknown, inventory: ArtifactInventory) {
  const app = ApplicationSchema.parse(raw);
  if (app.metadata.name === "apps") return;
  if (app.spec.source === undefined) {
    inventory.reasons.add(
      `Application ${app.metadata.name} has no single source`,
    );
    return;
  }
  const repositoryHost = applicationRepositoryHost(app.spec.source.repoURL);
  if (repositoryHost === undefined) {
    inventory.reasons.add(
      `Application ${app.metadata.name} has an invalid repository identifier`,
    );
    return;
  }
  if (repositoryHost !== "chartmuseum.tailnet-1a49.ts.net") return;
  const actual = app.status?.sync?.revision;
  if (actual === undefined)
    inventory.reasons.add(
      `Application ${app.metadata.name} has no deployed revision`,
    );
  else addArtifact(actual, inventory, `Application ${app.metadata.name}`);
  if (app.spec.source.targetRevision !== "~2.0.0-0")
    addArtifact(
      app.spec.source.targetRevision,
      inventory,
      `Application ${app.metadata.name} desired`,
    );
}

function observeContainers(
  raw: unknown,
  path: string,
  inventory: ArtifactInventory,
) {
  const spec =
    path === "/api/v1/pods"
      ? PodSchema.parse(raw).spec
      : DeploymentSchema.parse(raw).spec.template.spec;
  for (const container of [
    ...spec.containers,
    ...(spec.initContainers ?? []),
  ]) {
    if (!container.image.startsWith("ghcr.io/shepherdjerred/")) continue;
    addArtifact(
      container.image.split(":").slice(1).join(":"),
      inventory,
      container.image,
    );
  }
}

async function readInventory(path: string, read: RetentionRequest) {
  const items: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const parameters = new URLSearchParams({ limit: "100", continue: cursor });
    const list = ListSchema.parse(
      await read(`${path}?${parameters.toString()}`),
    );
    items.push(...list.items);
    cursor = list.metadata.continue ?? "";
    if (cursor === "") return items;
  }
  throw new Error(
    "Deployment reference inventory exceeds pagination safety bound",
  );
}

export async function deployedArtifactReferences(read: RetentionRequest) {
  const inventory: ArtifactInventory = {
    numbers: new Set(),
    reasons: new Set(),
  };
  for (const path of [
    "/api/v1/pods",
    "/apis/apps/v1/deployments",
    "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications",
  ]) {
    for (const raw of await readInventory(path, read)) {
      if (path.includes("argoproj.io")) observeApplication(raw, inventory);
      else observeContainers(raw, path, inventory);
    }
  }
  if (inventory.numbers.size === 0)
    inventory.reasons.add(
      "No current Woodpecker-published artifact references were proven",
    );
  return {
    numbers: inventory.numbers,
    complete: inventory.reasons.size === 0,
    protectionReasons: [...inventory.reasons].slice(0, 100),
  };
}

export async function retentionReferences(
  repo: RetentionRepo,
  woodpecker: RetentionRequest,
  github: RetentionRequest,
  kubernetes: RetentionRequest,
) {
  const heads = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const prs = PullRequestsSchema.parse(
      await github(
        `/repos/${repo.full_name}/pulls?state=open&per_page=100&page=${String(page)}`,
      ),
    );
    for (const pr of prs) heads.add(pr.head.sha);
    if (prs.length < 100) break;
    if (page === 100)
      throw new Error(
        "Open PR reference inventory exceeds pagination safety bound",
      );
  }
  const latest = z.array(RetentionPipelineSchema).parse(
    await woodpecker(
      // PR pipelines share their target branch; only a push proves this
      // default branch's latest successful build (Woodpecker 3.18.1).
      `/api/repos/${String(repo.id)}/pipelines?${new URLSearchParams({ branch: repo.default_branch, event: "push", status: "success", perPage: "1" }).toString()}`,
    ),
  );
  if (latest[0] !== undefined) heads.add(latest[0].commit);
  if (repo.full_name !== "shepherdjerred/monorepo")
    return {
      heads,
      numbers: new Set<number>(),
      protectAllMain: true,
      protectionReasons: [
        `No deployed artifact ownership resolver for ${repo.full_name}`,
      ],
    };
  const deployed = await deployedArtifactReferences(kubernetes);
  return {
    heads,
    numbers: deployed.numbers,
    protectAllMain: !deployed.complete,
    protectionReasons: deployed.protectionReasons,
  };
}
