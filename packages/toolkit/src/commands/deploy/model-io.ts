import {
  CatalogDocumentSchema,
  type StoredSnapshotObject,
} from "@shepherdjerred/delivery/model-contract";
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
