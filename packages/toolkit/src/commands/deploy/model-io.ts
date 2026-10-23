import {
  CatalogDocumentSchema,
  type StoredSnapshotObject,
} from "@shepherdjerred/delivery/model-contract";
import { pathToFileURL } from "node:url";
import { CatalogCoreSchema } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { loadCatalogDocument } from "@shepherdjerred/ops-model/delivery-catalog/files.ts";
import { repoRoot } from "#lib/deployed/git.ts";
import { required, type DeployOptions } from "./common.ts";

/**
 * Reads one object of the cold-start store with the writer's `fingerprint`
 * metadata; injected by tests.
 */
export type ObjectReader = (location: {
  endpoint: string;
  bucket: string;
  key: string;
}) => Promise<StoredSnapshotObject>;

export type ModelOptions = DeployOptions & {
  requestNotice?: (id: string) => void;
  /** Announces the catalog revision a reconcile sends. */
  catalogNotice?: (revision: string) => void;
  readObject?: ObjectReader;
};
export type ModelResult = Promise<{ result: unknown; exitCode: number }>;

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
