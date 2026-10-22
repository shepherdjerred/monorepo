import { createHash } from "node:crypto";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Database } from "#infrastructure/database.ts";

/** Services whose targets host the executor, the API or the Kubernetes adapter (D8). */
const SELF_HOSTED = new Set([
  "delivery",
  "delivery-control-plane",
  "temporal",
  "argocd",
]);

/**
 * Registers every service of a test catalog the way a catalog reconcile does
 * (C1): active, with no declared components yet, under a test catalog
 * revision. Upserts so a reset cluster and a fresh one converge.
 */
export async function registerTestServices(
  database: Database,
  catalog: ServiceIndex = new ServiceIndex(),
) {
  for (const service of catalog.services)
    await registerTestService(database, service.id);
}

/** One service the v1 test catalog does not list, such as a per-site service (X4). */
export async function registerTestService(database: Database, id: string) {
  const row = {
    lifecycle: "active",
    selfHosted: SELF_HOSTED.has(id),
    components: [],
    lineage: createHash("sha256").update("").digest("hex"),
    catalogRevision: "test-catalog",
  };
  await database.service.upsert({
    where: { id },
    create: { id, ...row },
    update: row,
  });
}

/**
 * Declares, as the catalog document would, that a service acquires these
 * components (section 4.5), so the acquisition endpoint admits them.
 */
export async function declareAcquisitions(
  database: Database,
  id: string,
  components: readonly string[],
) {
  await database.service.update({
    where: { id },
    data: {
      components: components.map((name) => ({ name, producer: "acquisition" })),
    },
  });
}
