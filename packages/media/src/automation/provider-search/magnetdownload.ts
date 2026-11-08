import { z } from "zod";
import type { ReconciliationScan } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { IntegrationError } from "#integrations/http.ts";
import {
  type MagnetDownloadProvider,
  MagnetDownloadResultSchema,
  magnetDownloadCandidate,
} from "#integrations/magnetdownload.ts";
import type { ProviderSearch } from "#integrations/providers.ts";

const KIND = "magnetdownload_search_v1";
const Header = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: z.literal("magnetdownload"),
  queryHash: z.string().regex(/^[a-f\d]{64}$/u),
  encryptedSnapshot: z.string().min(1),
});
const Snapshot = z
  .strictObject({
    schemaVersion: z.literal(1),
    results: z.array(MagnetDownloadResultSchema.strict()).max(3),
    hashes: z.array(z.string().regex(/^[a-f\d]{40}$/u)).max(3),
  })
  .refine(
    (value) => value.hashes.length <= value.results.length,
    "Resolved hashes must be a prefix of the retained search",
  );
type Ports = { db: Database; cipher: CredentialCipher; ownerId: string };

function readSnapshot(
  ports: Ports,
  row: ReconciliationScan,
  queryHash: string,
) {
  const header = Header.parse(row.progress);
  if (row.kind !== KIND || header.queryHash !== queryHash)
    throw new Error("MagnetDownload search checkpoint identity changed");
  const snapshot = Snapshot.parse(
    JSON.parse(ports.cipher.decrypt(header.encryptedSnapshot, row.id)),
  );
  const complete = snapshot.hashes.length === snapshot.results.length;
  if (
    (row.state !== "running" && row.state !== "completed") ||
    (row.state === "completed") !== complete ||
    (row.completedAt !== null) !== complete
  )
    throw new Error("MagnetDownload search checkpoint state changed");
  return snapshot;
}

async function saveSnapshot(
  ports: Ports,
  input: {
    id: string;
    queryHash: string;
    previous: ReconciliationScan | null;
    snapshot: z.infer<typeof Snapshot>;
  },
) {
  const snapshot = Snapshot.parse(input.snapshot);
  const progress = Header.parse({
    schemaVersion: 1,
    providerId: "magnetdownload",
    queryHash: input.queryHash,
    encryptedSnapshot: ports.cipher.encrypt(JSON.stringify(snapshot), input.id),
  });
  const complete = snapshot.hashes.length === snapshot.results.length;
  const data = {
    progress,
    state: complete ? "completed" : "running",
    completedAt: complete ? new Date() : null,
  };
  return ports.db.$transaction(async (tx) => {
    // Fence this exact owner before any checkpoint write; no lease is renewed.
    const lease = await tx.providerLease.updateMany({
      where: {
        providerId: "magnetdownload",
        ownerId: ports.ownerId,
        leaseUntil: { gt: new Date() },
      },
      data: { ownerId: ports.ownerId },
    });
    if (lease.count !== 1)
      throw new IntegrationError("magnetdownload", "conflict");
    if (input.previous === null)
      return tx.reconciliationScan.create({
        data: { id: input.id, kind: KIND, ...data },
      });
    const updated = await tx.reconciliationScan.updateMany({
      where: {
        id: input.id,
        kind: KIND,
        state: input.previous.state,
        progress: { equals: Header.parse(input.previous.progress) },
      },
      data,
    });
    if (updated.count !== 1)
      throw new IntegrationError("magnetdownload", "conflict");
    return tx.reconciliationScan.findUniqueOrThrow({ where: { id: input.id } });
  });
}

/** The existing pacing boundary may defer any next request. Keep actual
 * completed reads durable so another leased invocation resumes, not searches. */
export async function resumeMagnetDownloadSearch(
  ports: Ports,
  client: MagnetDownloadProvider,
  input: ProviderSearch,
) {
  if (input.page !== undefined && input.page !== 1) return [];
  const queryHash = identityHash({
    query: input.query,
    kind: input.kind,
    page: 1,
  });
  const id = `${KIND}:${queryHash}`;
  let row = await ports.db.reconciliationScan.findUnique({ where: { id } });
  let snapshot = row === null ? null : readSnapshot(ports, row, queryHash);
  if (row === null || row.state === "completed") {
    const results = await client.search(input.query);
    snapshot = Snapshot.parse({
      schemaVersion: 1,
      results: results.slice(0, 3),
      hashes: [],
    });
    row = await saveSnapshot(ports, { id, queryHash, previous: row, snapshot });
  }
  if (snapshot === null)
    throw new Error("MagnetDownload search snapshot missing");
  for (const result of snapshot.results.slice(snapshot.hashes.length)) {
    let candidate;
    try {
      candidate = await client.resolve(result);
    } catch (error) {
      if (
        !(error instanceof IntegrationError) ||
        error.kind !== "rate-limited" ||
        snapshot.hashes.length === 0
      )
        throw error;
      break;
    }
    snapshot = Snapshot.parse({
      ...snapshot,
      hashes: [...snapshot.hashes, candidate.infoHash],
    });
    row = await saveSnapshot(ports, { id, queryHash, previous: row, snapshot });
  }
  const retained = snapshot;
  return retained.hashes.map((hash, index) => {
    const result = retained.results[index];
    if (result === undefined)
      throw new Error("MagnetDownload resolved result missing");
    return magnetDownloadCandidate(result, hash);
  });
}
