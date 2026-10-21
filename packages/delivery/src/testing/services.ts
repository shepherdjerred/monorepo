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
  const lineage = createHash("sha256").update("").digest("hex");
  for (const service of catalog.services) {
    const row = {
      lifecycle: "active",
      selfHosted: SELF_HOSTED.has(service.id),
      components: [],
      lineage,
      catalogRevision: "test-catalog",
    };
    await database.service.upsert({
      where: { id: service.id },
      create: { id: service.id, ...row },
      update: row,
    });
  }
}
