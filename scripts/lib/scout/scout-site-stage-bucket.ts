import { s3StaticSiteNeedsSync } from "../s3-static-site.ts";
import { SEAWEEDFS_AWS_ENV, SEAWEEDFS_ENDPOINT } from "../seaweedfs.ts";
import { scoutStorageRoot } from "./scout-storage-runtime.ts";

type ScoutStage = "beta" | "prod";
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type NeedsSync = (source: string, bucket: string) => Promise<boolean>;
type Sleep = (milliseconds: number) => Promise<void>;

const ARCHIVE_RECONCILIATION_ATTEMPTS = 12;
const ARCHIVE_RECONCILIATION_DELAY_MS = 5000;
const DOCS_ROUTE_REQUEST_TIMEOUT_MS = 10_000;

const STAGE_ORIGINS: Record<ScoutStage, string> = {
  beta: "https://beta.scout-for-lol.com",
  prod: "https://scout-for-lol.com",
};

const STAGE_BUCKETS: Record<ScoutStage, string> = {
  beta: "scout-frontend-beta",
  prod: "scout-frontend",
};

export function stageBucketNeedsSync(
  source: string,
  bucket: string,
): Promise<boolean> {
  return s3StaticSiteNeedsSync({
    source,
    bucket,
    endpoint: SEAWEEDFS_ENDPOINT,
    cwd: scoutStorageRoot(),
    env: SEAWEEDFS_AWS_ENV,
  });
}

export async function archiveDocsRoutes(directory: string): Promise<string[]> {
  const routes: string[] = [];
  for await (const path of new Bun.Glob("docs/**/index.html").scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    routes.push(`/${path.slice(0, -"index.html".length)}`);
  }
  return routes.sort();
}

export async function assertDocsRoutesReachable(opts: {
  stage: ScoutStage;
  docsDirectory: string;
  fetch: Fetch;
}): Promise<void> {
  const routes = await archiveDocsRoutes(opts.docsDirectory);
  if (routes.length === 0) {
    // Content-addressed archives from before the docs site remain valid
    // rollback targets. There is no docs surface to probe for those releases.
    return;
  }
  const failures: string[] = [];
  for (const routesBatch of Array.from(
    { length: Math.ceil(routes.length / 8) },
    (_, index) => routes.slice(index * 8, (index + 1) * 8),
  )) {
    const batchFailures = await Promise.all(
      routesBatch.map(async (route) => {
        const response = await opts.fetch(
          new URL(route, STAGE_ORIGINS[opts.stage]),
          {
            redirect: "manual",
            signal: AbortSignal.timeout(DOCS_ROUTE_REQUEST_TIMEOUT_MS),
          },
        );
        return response.status === 200
          ? undefined
          : `${route} (${response.status.toString()})`;
      }),
    );
    failures.push(...batchFailures.filter((failure) => failure !== undefined));
  }
  if (failures.length > 0) {
    throw new Error(
      `public documentation routes failed: ${failures.join(", ")}`,
    );
  }
}

export async function stageArchiveIsLive(opts: {
  stage: ScoutStage;
  source: string;
  syncSource?: string;
  fetch?: Fetch;
  needsSync?: NeedsSync;
}): Promise<boolean> {
  const storageSource = opts.syncSource ?? opts.source;
  // A remote archive and its live bucket have independent object metadata,
  // so an S3 sync probe cannot establish equality between them. Release
  // callers compare every selected object by bytes after this check; the
  // custom probe remains available for callers that need structural checks.
  if (
    (opts.needsSync !== undefined || opts.syncSource === undefined) &&
    (await (opts.needsSync ?? stageBucketNeedsSync)(
      storageSource,
      STAGE_BUCKETS[opts.stage],
    ))
  ) {
    return false;
  }
  await assertDocsRoutesReachable({
    stage: opts.stage,
    docsDirectory: opts.source,
    fetch: opts.fetch ?? fetch,
  });
  return true;
}

export async function assertStageArchiveIsLive(
  stage: ScoutStage,
  source: string,
  options: {
    fetch?: Fetch;
    needsSync?: NeedsSync;
    syncSource?: string;
    sleep?: Sleep;
  } = {},
): Promise<void> {
  let lastError = new Error(
    `${stage} static site differs from the release archive`,
  );
  for (let attempt = 0; attempt < ARCHIVE_RECONCILIATION_ATTEMPTS; attempt++) {
    const result = await stageArchiveCheck(stage, source, options);
    if (result === undefined) {
      return;
    }
    lastError = result;
    if (attempt < ARCHIVE_RECONCILIATION_ATTEMPTS - 1) {
      await (options.sleep ?? Bun.sleep)(ARCHIVE_RECONCILIATION_DELAY_MS);
    }
  }
  throw lastError;
}

async function stageArchiveCheck(
  stage: ScoutStage,
  source: string,
  options: {
    fetch?: Fetch;
    needsSync?: NeedsSync;
    syncSource?: string;
  },
): Promise<Error | undefined> {
  try {
    const isLive = await stageArchiveIsLive({
      stage,
      source,
      ...(options.syncSource === undefined
        ? {}
        : { syncSource: options.syncSource }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.needsSync === undefined
        ? {}
        : { needsSync: options.needsSync }),
    });
    return isLive
      ? undefined
      : new Error(`${stage} static site differs from the release archive`);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
