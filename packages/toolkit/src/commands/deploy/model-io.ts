import { CatalogDocumentSchema } from "@shepherdjerred/delivery/model-contract";
import { pathToFileURL } from "node:url";
import { parseCatalog } from "@shepherdjerred/ops-model/catalog.ts";
import { CatalogCoreSchema } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { loadCatalogDocument } from "@shepherdjerred/ops-model/delivery-catalog/files.ts";
import { fetchMain, isAncestor, repoRoot } from "#lib/deployed/git.ts";
import {
  getPipeline,
  listPipelines,
  loadWoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import { required, type DeployOptions } from "./common.ts";

export type ModelOptions = DeployOptions & {
  requestNotice?: (id: string) => void;
  /** Announces the catalog revision a reconcile sends. */
  catalogNotice?: (revision: string) => void;
  /** Verifies a service is already absent/retired on origin/main and past helm-push before retiring. */
  assertServiceRetirableOnMain?: (serviceId: string) => Promise<void>;
};
export type ModelResult = Promise<{ result: unknown; exitCode: number }>;

const CATALOG_CORE_GIT_PATH = "packages/ops-model/catalog-document.json";
const SERVICES_CATALOG_GIT_PATH = "packages/ops-model/services.json";

export type RetireMainGuardDeps = {
  readonly findRepoRoot?: (() => Promise<string | null>) | undefined;
  readonly fetchOriginMain?: (() => Promise<boolean>) | undefined;
  readonly readGitObject?:
    ((spec: string, cwd: string) => Promise<string | null>) | undefined;
  readonly latestCatalogCommitOnMain?:
    ((cwd: string) => Promise<string | null>) | undefined;
  readonly isCommitAncestor?:
    ((ancestor: string, descendant: string) => Promise<boolean>) | undefined;
  readonly listMainPipelines?:
    | ((
        removalCommit: string,
      ) => Promise<
        readonly { readonly number: number; readonly commit: string }[]
      >)
    | undefined;
  readonly readMainPipeline?:
    | ((
        pipelineNumber: number,
      ) => Promise<Pick<WoodpeckerPipeline, "number" | "commit" | "workflows">>)
    | undefined;
};

async function runGitText(
  args: readonly string[],
  cwd: string,
): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  const trimmed = stdout.trim();
  return exitCode === 0 && trimmed.length > 0 ? trimmed : null;
}

function assertNotActiveInCatalogCore(
  rawJson: string,
  serviceId: string,
): void {
  const core = CatalogCoreSchema.parse(JSON.parse(rawJson));
  const activeService = core.services.some(
    (service) => service.id === serviceId && service.lifecycle === "active",
  );
  const activeEnv = core.environments.some(
    (env) => env.id.startsWith(`${serviceId}/`) && env.lifecycle === "active",
  );
  if (activeService || activeEnv) {
    throw new Error(
      `Refusing to retire ${serviceId}: still lifecycle "active" in origin/main:${CATALOG_CORE_GIT_PATH}. Merge the removal to main and wait for helm-push first, or pass --force-while-on-main.`,
    );
  }
}

function assertNotOwnedInServicesJson(
  rawJson: string,
  serviceId: string,
): void {
  const catalog = parseCatalog(JSON.parse(rawJson));
  const ownedService = catalog.services.some(
    (service) =>
      service.id === serviceId || service.aliases.includes(serviceId),
  );
  const delegatedEnv = Object.values(catalog.deliveryDelegations ?? {}).some(
    (environment) => environment.startsWith(`${serviceId}/`),
  );
  if (ownedService || delegatedEnv) {
    throw new Error(
      `Refusing to retire ${serviceId}: still owned in origin/main:${SERVICES_CATALOG_GIT_PATH}. Merge the removal to main and wait for helm-push first, or pass --force-while-on-main.`,
    );
  }
}

async function verifyHelmPushCompletedAfterCommit(
  serviceId: string,
  removalCommit: string,
  deps: RetireMainGuardDeps,
): Promise<void> {
  const checkAncestor = deps.isCommitAncestor ?? isAncestor;
  let listMain = deps.listMainPipelines;
  let readPipeline = deps.readMainPipeline;
  if (listMain === undefined || readPipeline === undefined) {
    const config = await loadWoodpeckerConfig();
    listMain ??= (targetSha) =>
      listPipelines(config, {
        event: ["push", "manual"],
        branch: "main",
        stopWhen: (entries) =>
          entries.length >= 100 ||
          entries.some(
            (entry) => entry.commit === targetSha && entry.event === "push",
          ),
      });
    readPipeline ??= (pipelineNumber) => getPipeline(pipelineNumber, config);
  }
  const listed = await listMain(removalCommit);
  for (const entry of listed) {
    const coversCommit =
      entry.commit === removalCommit ||
      (await checkAncestor(removalCommit, entry.commit));
    if (!coversCommit) {
      continue;
    }
    const pipeline = await readPipeline(entry.number);
    const helmPushSucceeded = pipeline.workflows.some(
      (workflow) =>
        workflow.name === "helm-push" &&
        workflow.state.toLowerCase() === "success",
    );
    if (helmPushSucceeded) {
      return;
    }
  }
  throw new Error(
    `Refusing to retire ${serviceId}: no main Woodpecker pipeline at or descending from ${removalCommit} completed workflow helm-push with state "success". Wait with 'toolkit ci wait --main --head ${removalCommit}' or pass --force-while-on-main.`,
  );
}

/**
 * Ensures `serviceId` is already retired/removed from `origin/main` catalog
 * files and that a `main` pipeline at or after that catalog commit completed
 * `helm-push` with `state === "success"`, preventing the one-way Delivery
 * retirement from wedging `helm-push` on `main`.
 */
export async function assertServiceRetirableOnMain(
  serviceId: string,
  deps: RetireMainGuardDeps = {},
): Promise<void> {
  const root = await (deps.findRepoRoot ?? repoRoot)();
  if (root === null) {
    throw new Error(
      `Refusing to retire ${serviceId}: run inside the monorepo checkout to verify origin/main, or pass --force-while-on-main.`,
    );
  }
  const fetched = await (deps.fetchOriginMain ?? fetchMain)();
  if (!fetched) {
    throw new Error(
      `Refusing to retire ${serviceId}: could not fetch origin/main; verify git network access or pass --force-while-on-main.`,
    );
  }
  const readGitObject =
    deps.readGitObject ??
    ((spec: string, cwd: string) => runGitText(["show", spec], cwd));
  const [rawCore, rawServices] = await Promise.all([
    readGitObject(`origin/main:${CATALOG_CORE_GIT_PATH}`, root),
    readGitObject(`origin/main:${SERVICES_CATALOG_GIT_PATH}`, root),
  ]);
  if (rawCore === null || rawServices === null) {
    throw new Error(
      `Refusing to retire ${serviceId}: could not read catalog files from origin/main; pass --force-while-on-main to override.`,
    );
  }
  assertNotActiveInCatalogCore(rawCore, serviceId);
  assertNotOwnedInServicesJson(rawServices, serviceId);

  const latestCommit =
    deps.latestCatalogCommitOnMain ??
    ((cwd: string) =>
      runGitText(
        [
          "log",
          "-1",
          "--format=%H",
          "origin/main",
          "--",
          `:/${CATALOG_CORE_GIT_PATH}`,
          `:/${SERVICES_CATALOG_GIT_PATH}`,
        ],
        cwd,
      ));
  const removalCommit = await latestCommit(root);
  if (removalCommit === null) {
    throw new Error(
      `Refusing to retire ${serviceId}: could not find latest catalog commit on origin/main; pass --force-while-on-main to override.`,
    );
  }
  await verifyHelmPushCompletedAfterCommit(serviceId, removalCommit, deps);
}

export function requireMachine(options: DeployOptions, what: string) {
  if (!options.machine)
    throw new Error(`${what} requires its scoped --machine credential`);
}

/** The caller's idempotency key, or a new one announced before submission. */
export function requestId(options: ModelOptions) {
  const id = options["request-id"] ?? crypto.randomUUID();
  options.requestNotice?.(id);
  return id;
}

export async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`No such file: ${path}`);
  const raw: unknown = await file.json();
  return raw;
}

/** The catalog document named by `--file`, checked against the catalog contract. */
export async function catalogDocument(options: DeployOptions) {
  return CatalogDocumentSchema.parse(await readJson(required(options.file)));
}

/**
 * The committed catalog of the monorepo checkout the toolkit runs in: its
 * reviewed core and every environment's revision files, assembled by
 * `loadCatalogDocument()`. A compiled toolkit carries neither, so both are
 * read from the checkout.
 */
async function committedCatalogDocument() {
  const root = await repoRoot();
  if (root === null)
    throw new Error(
      "deploy catalog reconcile without --file reads the committed catalog; run it inside the monorepo checkout",
    );
  const core = CatalogCoreSchema.parse(
    await readJson(`${root}/packages/ops-model/catalog-document.json`),
  );
  return CatalogDocumentSchema.parse(
    await loadCatalogDocument(
      pathToFileURL(`${root}/packages/delivery/registrations/v2/`),
      core,
    ),
  );
}

/** The document a reconcile sends: the one `--file` names, or else the committed catalog. */
export async function reconcileDocument(options: DeployOptions) {
  return options.file === undefined
    ? committedCatalogDocument()
    : catalogDocument(options);
}
