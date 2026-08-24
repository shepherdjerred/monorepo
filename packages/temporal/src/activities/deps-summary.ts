import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Context } from "@temporalio/activity";
import { rm } from "node:fs/promises";
import { simpleGit, type SimpleGit } from "simple-git";
import { z } from "zod/v4";
import {
  fetchDependencyReleaseNotes,
  synthesizeDependencyChanges,
} from "./deps-summary-release-notes.ts";
import type {
  DependencyChange,
  DependencyChangeKind,
} from "#shared/deps-summary-types.ts";

const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";
// The catalog lived here before it became its own workspace, and `versions.ts`
// was already a projection of it. Reading history across that move therefore
// needs all three eras: the current catalog, the catalog at its former path,
// and only then the pre-catalog literal `versions.ts`.
const PRIOR_VERSION_CATALOG_PATH =
  "packages/homelab/src/cdk8s/src/version-catalog.json";
const LEGACY_VERSIONS_PATH = "packages/homelab/src/cdk8s/src/versions.ts";
export const CATALOG_HISTORY_PATHS = [
  VERSION_CATALOG_PATH,
  PRIOR_VERSION_CATALOG_PATH,
  LEGACY_VERSIONS_PATH,
] as const;
const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const CHECKPOINT_KEY = "reports/state/deps-summary-weekly.json";

export const DEPS_SUMMARY_CLONE_ARGS = [
  "--filter=blob:none",
  "--single-branch",
  "--branch=main",
] as const;

const ManagementSchema = z.discriminatedUnion("managed", [
  z.object({
    managed: z.literal(true),
    datasource: z.string().min(1),
    versioning: z.string().min(1),
    registryUrl: z.url().optional(),
    packageName: z.string().min(1).optional(),
  }),
  z.object({ managed: z.literal(false) }),
]);
export const CatalogEntrySchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  category: z.enum(["upstream", "internal-image"]),
  artifactType: z.enum(["image", "helm-chart", "package", "source"]),
  management: ManagementSchema,
  releaseNotesOverride: z
    .object({ url: z.url().optional(), summary: z.string().min(1) })
    .optional(),
});
const CatalogSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(CatalogEntrySchema),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

const CheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  acceptedAt: z.iso.datetime({ offset: true }),
  reportRunId: z.string().min(1),
});

export type DependencyCollectionResult = {
  baseSha: string;
  headSha: string;
  usedCheckpoint: boolean;
  endpointStatesIdentical: boolean;
  changes: DependencyChange[];
};

type StateStore = { client: S3Client; bucket: string };

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for dependency report state`);
  }
  return value;
}

function stateStore(): StateStore {
  const accessKeyId = requiredEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("AWS_SECRET_ACCESS_KEY");
  const sessionToken = Bun.env["AWS_SESSION_TOKEN"];
  return {
    client: new S3Client({
      endpoint: requiredEnv("S3_ENDPOINT"),
      region: Bun.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      credentials:
        sessionToken === undefined || sessionToken === ""
          ? { accessKeyId, secretAccessKey }
          : { accessKeyId, secretAccessKey, sessionToken },
    }),
    bucket:
      Bun.env["REPORT_RECEIPT_BUCKET"] ??
      Bun.env["REVIEW_SIGNAL_ARCHIVE_BUCKET"] ??
      "llm-archive",
  };
}

async function readCheckpoint(): Promise<
  z.infer<typeof CheckpointSchema> | undefined
> {
  const store = stateStore();
  try {
    const result = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: CHECKPOINT_KEY }),
    );
    if (result.Body === undefined) {
      throw new Error("dependency report checkpoint has no body");
    }
    return CheckpointSchema.parse(
      JSON.parse(await result.Body.transformToString()),
    );
  } catch (error: unknown) {
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404)
    ) {
      return undefined;
    }
    throw error;
  }
}

function parseCatalog(text: string): CatalogEntry[] {
  return CatalogSchema.parse(JSON.parse(text)).entries;
}

function inferLegacyArtifactType(
  datasource: string | undefined,
  value: string,
  name: string,
): CatalogEntry["artifactType"] {
  if (datasource === "helm" || name === "agent-stack-k8s" || name === "kueue") {
    return "helm-chart";
  }
  if (datasource === "npm") return "package";
  if (datasource === "docker" || value.includes("@sha256:")) return "image";
  return "source";
}

function legacyKey(trimmed: string): string | undefined {
  return (
    /^"([^"]+)"\s*:/.exec(trimmed)?.[1] ?? /^([\w-]+)\s*:/.exec(trimmed)?.[1]
  );
}

function legacyAnnotation(comments: string[]): RegExpExecArray | undefined {
  return comments
    .map((comment) =>
      /renovate: datasource=(\S+)(?: registryUrl=(\S+))? versioning=(\S+)(?: packageName=(\S+))?/.exec(
        comment,
      ),
    )
    .find((match) => match !== null);
}

function legacyCatalogEntry(
  key: string,
  value: string,
  comments: string[],
): CatalogEntry {
  const annotation = legacyAnnotation(comments);
  const datasource = annotation?.[1];
  const registryUrl = annotation?.[2];
  const versioning = annotation?.[3];
  const packageName = annotation?.[4];
  return CatalogEntrySchema.parse({
    name: key,
    value,
    category: key.startsWith("shepherdjerred/") ? "internal-image" : "upstream",
    artifactType: inferLegacyArtifactType(datasource, value, key),
    management:
      datasource === undefined || versioning === undefined
        ? { managed: false }
        : {
            managed: true,
            datasource,
            versioning,
            ...(registryUrl === undefined ? {} : { registryUrl }),
            ...(packageName === undefined ? {} : { packageName }),
          },
  });
}

export function parseLegacyVersionsSource(source: string): CatalogEntry[] {
  const objectStart = source.indexOf("const versions = {");
  const objectEnd = source.indexOf("\n};", objectStart);
  if (objectStart === -1 || objectEnd === -1) {
    throw new Error("legacy versions.ts has no versions object");
  }
  const lines = source.slice(objectStart, objectEnd).split("\n");
  const entries: CatalogEntry[] = [];
  let comments: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) {
      comments.push(trimmed.replace(/^\/\/\s?/, ""));
      continue;
    }
    const key = legacyKey(trimmed);
    if (key === undefined) {
      if (trimmed !== "" && !/^"[^"]+",?$/.test(trimmed)) comments = [];
      continue;
    }
    const inlineValue = /:\s*"([^"]+)"/.exec(trimmed)?.[1];
    const nextValue = /^"([^"]+)"/.exec((lines[index + 1] ?? "").trim())?.[1];
    const value = inlineValue ?? nextValue;
    if (value === undefined)
      throw new Error(`legacy version ${key} has no value`);
    entries.push(legacyCatalogEntry(key, value, comments));
    comments = [];
  }
  return entries;
}

async function tryGitShow(
  git: SimpleGit,
  ref: string,
  path: string,
): Promise<string | undefined> {
  try {
    return await git.show([`${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

export async function catalogAt(
  git: SimpleGit,
  ref: string,
): Promise<CatalogEntry[]> {
  const catalog = await tryGitShow(git, ref, VERSION_CATALOG_PATH);
  if (catalog !== undefined) return parseCatalog(catalog);
  const priorCatalog = await tryGitShow(git, ref, PRIOR_VERSION_CATALOG_PATH);
  if (priorCatalog !== undefined) return parseCatalog(priorCatalog);
  const legacy = await tryGitShow(git, ref, LEGACY_VERSIONS_PATH);
  if (legacy !== undefined) return parseLegacyVersionsSource(legacy);
  throw new Error(`no version catalog exists at ${ref}`);
}

function mapEntries(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

function bareVersion(value: string | undefined): string | undefined {
  return value?.split("@")[0];
}

function sameState(left: CatalogEntry[], right: CatalogEntry[]): boolean {
  const rightMap = mapEntries(right);
  return (
    left.length === right.length &&
    left.every((entry) => rightMap.get(entry.name)?.value === entry.value)
  );
}

function changedEntries(
  before: CatalogEntry[],
  after: CatalogEntry[],
): { before: CatalogEntry | undefined; after: CatalogEntry | undefined }[] {
  const beforeMap = mapEntries(before);
  const afterMap = mapEntries(after);
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  return [...names]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const oldEntry = beforeMap.get(name);
      const newEntry = afterMap.get(name);
      return oldEntry?.value === newEntry?.value
        ? []
        : [{ before: oldEntry, after: newEntry }];
    });
}

function dependencyChangeKind(
  before: CatalogEntry | undefined,
  after: CatalogEntry | undefined,
  entry: CatalogEntry,
  isRevert: boolean,
): DependencyChangeKind {
  if (before === undefined) return "addition";
  if (after === undefined) return "removal";
  if (isRevert) return "revert";
  return entry.category === "internal-image"
    ? "internal-promotion"
    : "upstream-upgrade";
}

export function deriveDependencyChanges(
  baseEntries: CatalogEntry[],
  commits: {
    commitSha: string;
    commitSubject: string;
    entries: CatalogEntry[];
  }[],
): DependencyChange[] {
  const seen = new Map<string, Set<string>>();
  for (const entry of baseEntries) seen.set(entry.name, new Set([entry.value]));
  const changes: DependencyChange[] = [];
  let priorEntries = baseEntries;
  for (const commit of commits) {
    for (const pair of changedEntries(priorEntries, commit.entries)) {
      const entry = pair.after ?? pair.before;
      if (entry === undefined) throw new Error("catalog diff has no entry");
      const priorValues = seen.get(entry.name) ?? new Set<string>();
      const isRevert =
        pair.after !== undefined && priorValues.has(pair.after.value);
      const kind = dependencyChangeKind(
        pair.before,
        pair.after,
        entry,
        isRevert,
      );
      const management = entry.management;
      changes.push({
        name: entry.name,
        category: entry.category,
        artifactType: entry.artifactType,
        datasource: management.managed ? management.datasource : undefined,
        registryUrl: management.managed ? management.registryUrl : undefined,
        packageName: management.managed ? management.packageName : undefined,
        oldValue: pair.before?.value,
        newValue: pair.after?.value,
        oldVersion: bareVersion(pair.before?.value),
        newVersion: bareVersion(pair.after?.value),
        kind,
        commitSha: commit.commitSha,
        commitSubject: commit.commitSubject,
        releaseNotesOverride: pair.after?.releaseNotesOverride,
      });
      if (pair.after !== undefined) {
        priorValues.add(pair.after.value);
        seen.set(entry.name, priorValues);
      }
    }
    priorEntries = commit.entries;
  }
  return changes;
}

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Unit tests call collectors outside an activity context.
  }
}

async function isAncestor(
  git: SimpleGit,
  base: string,
  head: string,
): Promise<boolean> {
  try {
    await git.raw(["merge-base", "--is-ancestor", base, head]);
    return true;
  } catch {
    return false;
  }
}

async function fallbackBase(git: SimpleGit, daysBack: number): Promise<string> {
  const before = new Date(
    Date.now() - daysBack * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rawSha = await git.raw([
    "rev-list",
    "-1",
    `--before=${before}`,
    "origin/main",
  ]);
  const sha = rawSha.trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error(
      `could not resolve dependency report base before ${before}`,
    );
  }
  return sha;
}

export async function collectDependencyChanges(
  daysBack: number,
): Promise<DependencyCollectionResult> {
  const tempDir = `/tmp/homelab-dep-summary-${crypto.randomUUID()}`;
  try {
    await simpleGit().clone(REPO_URL, tempDir, [...DEPS_SUMMARY_CLONE_ARGS]);
    const git = simpleGit(tempDir);
    const rawHeadSha = await git.revparse(["origin/main"]);
    const headSha = rawHeadSha.trim();
    const checkpoint = await readCheckpoint();
    const useCheckpoint =
      checkpoint !== undefined &&
      (await isAncestor(git, checkpoint.commitSha, headSha));
    const baseSha = useCheckpoint
      ? checkpoint.commitSha
      : await fallbackBase(git, daysBack);
    const baseEntries = await catalogAt(git, baseSha);
    const headEntries = await catalogAt(git, headSha);
    const rawCommits = await git.raw([
      "rev-list",
      "--reverse",
      `${baseSha}..${headSha}`,
      "--",
      ...CATALOG_HISTORY_PATHS,
    ]);
    const commits = rawCommits.trim().split("\n").filter(Boolean);
    const catalogCommits: {
      commitSha: string;
      commitSubject: string;
      entries: CatalogEntry[];
    }[] = [];
    for (const [index, commitSha] of commits.entries()) {
      safeHeartbeat({ phase: "catalog-diff", commitSha, index });
      const currentEntries = await catalogAt(git, commitSha);
      const rawCommitSubject = await git.raw([
        "show",
        "-s",
        "--format=%s",
        commitSha,
      ]);
      const commitSubject = rawCommitSubject.trim();
      catalogCommits.push({
        commitSha,
        commitSubject,
        entries: currentEntries,
      });
    }
    const changes = deriveDependencyChanges(baseEntries, catalogCommits);
    return {
      baseSha,
      headSha,
      usedCheckpoint: useCheckpoint,
      endpointStatesIdentical: sameState(baseEntries, headEntries),
      changes,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function advanceDependencySummaryCheckpoint(input: {
  commitSha: string;
  reportRunId: string;
  acceptedAt: string;
}): Promise<void> {
  const checkpoint = CheckpointSchema.parse({ schemaVersion: 1, ...input });
  const store = stateStore();
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: CHECKPOINT_KEY,
      Body: JSON.stringify(checkpoint, null, 2),
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

export type DepsSummaryActivities = typeof depsSummaryActivities;

export const depsSummaryActivities = {
  collectDependencyChanges,
  fetchDependencyReleaseNotes,
  synthesizeDependencyChanges,
  advanceDependencySummaryCheckpoint,
};
