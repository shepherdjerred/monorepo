import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  boundedBody,
  registryLocation,
  resolveManifest,
  type RegistryTransport,
} from "@shepherdjerred/delivery/oci-registry";
import type { KubernetesApplicationRecipe } from "./recipe.ts";

/** OCI capability label advertising supported `@shepherdjerred/feature-flags` modes. */
export const FEATURE_FLAGS_MODES_LABEL =
  "red.sjer.delivery.feature-flags-modes";

/** `#4948` (`ci/1/18413`): commit introducing `FEATURE_FLAGS_MODE=flags` across Temporal workers. */
export const FLAGS_CUTOVER_SOURCE_REVISION =
  "f545a3b02ffcb3a2545ae038bc2dc58e499a0c6f";

/** First-party CI version floor (`2.0.0-1018413` = `1_000_000 + 18413`) for `#4948`. */
export const FLAGS_CUTOVER_CI_BUILD_NUMBER = 1_018_413;

const CI_BUILD_VERSION = /^2\.0\.0-(\d+)$/u;
const MAX_UNTAR_BYTES = 64 * 1024 * 1024;
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

export class TrackedWorkerCompatibilityError extends Error {
  override readonly name = "TrackedWorkerCompatibilityError";
}

type WorkerArtifact = DeploymentDetail["versionSet"]["components"][string];
export type ImageLabelReader = (
  artifact: WorkerArtifact,
) => Promise<Record<string, string>>;

function nullTrimmed(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  return new TextDecoder().decode(
    zero === -1 ? bytes : bytes.subarray(0, zero),
  );
}

function parsePaxPath(payload: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(payload);
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ");
    if (space === -1) continue;
    const rest = line.slice(space + 1);
    if (rest.startsWith("path=")) return rest.slice("path=".length);
  }
  return undefined;
}

function resolveTarEntryPath(
  header: Uint8Array,
  pendingPath: string | undefined,
): string {
  if (pendingPath !== undefined) return pendingPath;
  const name = nullTrimmed(header.subarray(0, 100));
  const magic = nullTrimmed(header.subarray(257, 263));
  const prefix = magic.startsWith("ustar")
    ? nullTrimmed(header.subarray(345, 500))
    : "";
  return prefix === "" ? name : `${prefix}/${name}`;
}

function parseTarEntrySize(header: Uint8Array): number {
  const sizeText = nullTrimmed(header.subarray(124, 136)).trim();
  return sizeText === "" ? 0 : Number.parseInt(sizeText, 8);
}

/** Extract `templates/*.yaml` and `templates/*.yml` entries from a `.tgz` Helm chart archive. */
export function extractChartTemplates(
  archiveBytes: Uint8Array,
): { path: string; content: string }[] {
  const tar = gunzipSync(archiveBytes, { maxOutputLength: MAX_UNTAR_BYTES });
  const files: { path: string; content: string }[] = [];
  let offset = 0;
  let pendingPath: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const size = parseTarEntrySize(header);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length)
      throw new Error("Invalid tar entry size in published Helm chart archive");
    const payload = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const typeFlag = header[156] ?? 0;
    if (typeFlag === 120 || typeFlag === 76) {
      pendingPath =
        typeFlag === 120 ? parsePaxPath(payload) : nullTrimmed(payload);
      continue;
    }
    const entryPath = resolveTarEntryPath(header, pendingPath);
    pendingPath = undefined;
    if (
      (typeFlag === 0 || typeFlag === 48) &&
      /(?:^|\/)templates\/.+\.ya?ml$/u.test(entryPath)
    )
      files.push({
        path: entryPath,
        content: new TextDecoder().decode(payload),
      });
  }
  return files;
}

const ContainerEnvSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
});
const ContainerSchema = z.looseObject({
  name: z.string().optional(),
  image: z.string().optional(),
  env: z.array(ContainerEnvSchema).optional(),
});
const PodSpecSchema = z.looseObject({
  containers: z.array(ContainerSchema).optional(),
  initContainers: z.array(ContainerSchema).optional(),
});
const PodTemplateHolderSchema = z.looseObject({
  template: z.looseObject({ spec: z.unknown() }).optional(),
});
const CronJobSpecSchema = z.looseObject({
  jobTemplate: z
    .looseObject({ spec: PodTemplateHolderSchema.optional() })
    .optional(),
});
const KubernetesWorkloadSchema = z.looseObject({
  kind: z.string().optional(),
  metadata: z.looseObject({ name: z.string().optional() }).optional(),
  spec: z.unknown(),
});
const KubernetesListSchema = z.looseObject({
  kind: z.literal("List"),
  items: z.array(z.unknown()),
});

function podSpecOf(doc: z.infer<typeof KubernetesWorkloadSchema>): unknown {
  const { kind, spec } = doc;
  if (kind === "Pod") return spec;
  if (kind === "CronJob") {
    const cron = CronJobSpecSchema.safeParse(spec);
    return cron.success
      ? cron.data.jobTemplate?.spec?.template?.spec
      : undefined;
  }
  if (
    kind === "Deployment" ||
    kind === "StatefulSet" ||
    kind === "DaemonSet" ||
    kind === "Job"
  ) {
    const holder = PodTemplateHolderSchema.safeParse(spec);
    return holder.success ? holder.data.template?.spec : undefined;
  }
  return undefined;
}

function bindsTrackedWorkerImage(
  image: string | undefined,
  parameterPaths: readonly string[],
): boolean {
  return (
    image !== undefined &&
    parameterPaths.some((parameterPath) =>
      parameterPath
        .split(".")
        .every((segment) => segment !== "" && image.includes(segment)),
    )
  );
}

function expandYamlDocuments(parsed: unknown): unknown[] {
  const rawDocs = Array.isArray(parsed) ? parsed : [parsed];
  return rawDocs.flatMap((item): unknown[] => {
    const list = KubernetesListSchema.safeParse(item);
    return list.success ? list.data.items : [item];
  });
}

function matchingWorkloadLabel(
  raw: unknown,
  fallbackPath: string,
  parameterPaths: readonly string[],
): string | undefined {
  const doc = KubernetesWorkloadSchema.safeParse(raw);
  if (!doc.success) return undefined;
  const podSpec = PodSpecSchema.safeParse(podSpecOf(doc.data));
  if (!podSpec.success) return undefined;
  const containers = [
    ...(podSpec.data.containers ?? []),
    ...(podSpec.data.initContainers ?? []),
  ];
  const requiresFlags = containers.some(
    (container) =>
      bindsTrackedWorkerImage(container.image, parameterPaths) &&
      (container.env ?? []).some(
        (entry) =>
          entry.name === "FEATURE_FLAGS_MODE" && entry.value === "flags",
      ),
  );
  if (!requiresFlags) return undefined;
  const kind = doc.data.kind ?? "Workload";
  const name = doc.data.metadata?.name ?? fallbackPath;
  return `${kind}/${name}`;
}

function workloadsRequiringFlagsMode(
  templates: readonly { path: string; content: string }[],
  parameterPaths: readonly string[],
): string[] {
  const matches: string[] = [];
  for (const template of templates) {
    const docs = expandYamlDocuments(Bun.YAML.parse(template.content));
    for (const raw of docs) {
      const label = matchingWorkloadLabel(raw, template.path, parameterPaths);
      if (label !== undefined) matches.push(label);
    }
  }
  return matches;
}

const ManifestConfigSchema = z.looseObject({
  config: z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }),
});
const ManifestIndexSchema = z.looseObject({
  manifests: z.array(
    z.looseObject({
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      platform: z
        .looseObject({
          os: z.string().optional(),
          architecture: z.string().optional(),
        })
        .optional(),
    }),
  ),
});
const OciConfigBlobSchema = z.looseObject({
  config: z
    .looseObject({
      Labels: z.record(z.string(), z.string()).nullable().optional(),
    })
    .optional(),
});

function parseWwwAuthenticateParams(header: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const match of header.matchAll(/(\w+)="([^"]*)"/gu)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) params.set(key, value);
  }
  return params;
}

async function fetchAnonymousRegistryBlob(
  origin: string,
  repository: string,
  digest: string,
  transport: RegistryTransport,
): Promise<Uint8Array> {
  const url = `${origin}/v2/${repository}/blobs/${encodeURIComponent(digest)}`;
  let response = await transport(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401) {
    const header = response.headers.get("www-authenticate") ?? "";
    await response.body?.cancel();
    const values = parseWwwAuthenticateParams(header);
    const realm = z.url().parse(values.get("realm"));
    const tokenUrl = new URL(realm);
    const service = values.get("service");
    if (service !== undefined) tokenUrl.searchParams.set("service", service);
    tokenUrl.searchParams.set(
      "scope",
      values.get("scope") ?? `repository:${repository}:pull`,
    );
    const tokenRes = await transport(tokenUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const tokenBytes = await boundedBody(tokenRes, 65_536, "Registry token");
    const tokenJson = z
      .object({
        token: z.string().optional(),
        access_token: z.string().optional(),
      })
      .parse(JSON.parse(new TextDecoder().decode(tokenBytes)));
    const token = z
      .string()
      .min(1)
      .parse(tokenJson.token ?? tokenJson.access_token);
    response = await transport(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `OCI config blob read returned HTTP ${String(response.status)}`,
    );
  }
  return await boundedBody(response, MAX_CONFIG_BYTES, "OCI config blob");
}

export async function readOciImageLabels(
  artifact: WorkerArtifact,
  transport: RegistryTransport = fetch,
): Promise<Record<string, string>> {
  const slash = artifact.uri.indexOf("/");
  if (slash <= 0) throw new Error(`Invalid image artifact URI ${artifact.uri}`);
  const location = registryLocation(
    `https://${artifact.uri.slice(0, slash)}`,
    artifact.uri.slice(slash + 1),
  );
  let { bytes } = await resolveManifest(location, artifact.digest, transport);
  let parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const index = ManifestIndexSchema.safeParse(parsed);
  if (index.success) {
    const amd64 =
      index.data.manifests.find(
        (entry) =>
          entry.platform?.os === "linux" &&
          entry.platform.architecture === "amd64",
      ) ?? index.data.manifests[0];
    if (amd64 === undefined)
      throw new Error(
        `Image index ${artifact.uri}@${artifact.digest} is empty`,
      );
    ({ bytes } = await resolveManifest(location, amd64.digest, transport));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  }
  const configDigest = ManifestConfigSchema.parse(parsed).config.digest;
  const configBytes = await fetchAnonymousRegistryBlob(
    location.origin,
    location.repository,
    configDigest,
    transport,
  );
  const blob = OciConfigBlobSchema.parse(
    JSON.parse(new TextDecoder().decode(configBytes)),
  );
  return blob.config?.Labels ?? {};
}

async function workerSupportsFlagsMode(
  worker: WorkerArtifact,
  readLabels: ImageLabelReader,
): Promise<boolean> {
  if (worker.sourceRevision === FLAGS_CUTOVER_SOURCE_REVISION) return true;
  const ciMatch =
    worker.origin.kind === "first-party"
      ? CI_BUILD_VERSION.exec(worker.version)
      : null;
  if (ciMatch !== null) {
    const buildNumber = Number(ciMatch[1]);
    return (
      Number.isSafeInteger(buildNumber) &&
      buildNumber >= FLAGS_CUTOVER_CI_BUILD_NUMBER
    );
  }
  const labels = await readLabels(worker);
  const modes = (labels[FEATURE_FLAGS_MODES_LABEL] ?? "")
    .split(",")
    .map((mode) => mode.trim())
    .filter((mode) => mode !== "");
  return modes.includes("flags");
}

/**
 * Prevents applying a Helm chart whose `delivery.dependencies.temporal-worker`
 * workloads set `FEATURE_FLAGS_MODE=flags` alongside a tracked
 * `image:temporal-worker` built before the `#4948` Flags cutover (AI-833).
 */
export async function assertTrackedWorkerCompatibility(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  archiveBytes: Uint8Array | null,
  readLabels: ImageLabelReader = readOciImageLabels,
): Promise<void> {
  if (archiveBytes === null) return;
  const parameterPaths = Object.entries(recipe.artifactParameters)
    .filter(
      ([parameterPath, binding]) =>
        parameterPath === "delivery.dependencies.temporal-worker" ||
        (parameterPath.startsWith("delivery.dependencies.") &&
          binding.component === "image:temporal-worker"),
    )
    .map(([parameterPath]) => parameterPath);
  if (parameterPaths.length === 0) return;
  const templates = extractChartTemplates(archiveBytes);
  const workloads = workloadsRequiringFlagsMode(templates, parameterPaths);
  if (workloads.length === 0) return;
  const worker = current.versionSet.components["image:temporal-worker"];
  if (worker === undefined)
    throw new TrackedWorkerCompatibilityError(
      `Chart ${recipe.chartComponent} workloads (${workloads.join(", ")}) require image:temporal-worker with FEATURE_FLAGS_MODE=flags, but selection omits image:temporal-worker`,
    );
  if (await workerSupportsFlagsMode(worker, readLabels)) return;
  const chartVersion =
    current.versionSet.components[recipe.chartComponent]?.version ?? "unknown";
  throw new TrackedWorkerCompatibilityError(
    `Incompatible ${recipe.chartComponent}@${chartVersion} and tracked image:temporal-worker@${worker.version} (${worker.sourceRevision.slice(0, 12)}): ${workloads.join(", ")} set FEATURE_FLAGS_MODE=flags, which requires image:temporal-worker at or after Flags cutover 2.0.0-${String(FLAGS_CUTOVER_CI_BUILD_NUMBER)} (${FLAGS_CUTOVER_SOURCE_REVISION.slice(0, 12)}) or ${FEATURE_FLAGS_MODES_LABEL}=flags`,
  );
}
