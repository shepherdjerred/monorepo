import { environmentService } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import {
  type CatalogDocument,
  CatalogDocumentSchema,
  catalogRevision,
  serviceLineage,
} from "#shared/model/catalog-contract.ts";
import {
  CatalogReconcileRequestSchema,
  type CatalogReconcileRequest,
  type CatalogReconcileResult,
} from "#shared/model/catalog-reconcile-contract.ts";
import type { RecipeDefinition } from "#shared/model/recipe-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { id, type Transaction } from "#infrastructure/delivery-data.ts";
import { audit, fingerprint, lock } from "#infrastructure/delivery-records.ts";

type Result = CatalogReconcileResult;
type Lifecycle = "active" | "retired" | "removed";
const LIFECYCLE_RANK = new Map<string, number>([
  ["active", 0],
  ["retired", 1],
  ["removed", 2],
]);

function emptyResult(revision: string): Result {
  return {
    catalogRevision: revision,
    services: { created: [], lineageChanged: [], retired: [] },
    environments: { created: [], renamed: [], rebound: [], retired: [] },
    recipes: { created: [] },
    configurations: { created: [] },
    edges: 0,
    references: 0,
  };
}

/** Lifecycle moves forward only (4.2, 4.10). */
function requireForward(entity: string, from: string, to: Lifecycle) {
  const before = LIFECYCLE_RANK.get(from);
  if (before === undefined)
    throw new DeliveryError(
      "INVALID",
      `${entity} has unknown lifecycle ${from}`,
    );
  if ((LIFECYCLE_RANK.get(to) ?? 0) < before)
    throw new DeliveryError(
      "CONFLICT",
      `${entity} cannot move from ${from} back to ${to}`,
    );
}

/** A service whose deployments are owned or quarantined admits no definition change (C4, S3). */
async function requireUnowned(tx: Transaction, serviceId: string, why: string) {
  const owned = await tx.deployment.count({
    where: {
      serviceId,
      OR: [{ status: "running" }, { recoveryRequired: true }],
    },
  });
  if (owned > 0)
    throw new DeliveryError(
      "CONFLICT",
      `${why} is refused while a deployment of ${serviceId} is owned or recovery-required`,
    );
}

/** The Application an environment's recipe names first; T6 is checked by the catalog. */
function primaryApplication(definition: RecipeDefinition): string | null {
  switch (definition.kind) {
    case "kubernetes-application":
      return definition.application.name;
    case "operator-run":
      return primaryApplication(definition.wrapped);
    case "compound":
      for (const sub of definition.subRecipes) {
        const name = primaryApplication(sub.definition);
        if (name !== null) return name;
      }
      return null;
    case "static-site":
    case "tofu":
    case "channel":
      return null;
  }
}

async function reconcileServices(
  tx: Transaction,
  document: CatalogDocument,
  result: Result,
) {
  for (const service of document.services) {
    const lineage = await serviceLineage(
      service.components.map((component) => component.name),
    );
    const data = {
      lifecycle: service.lifecycle,
      selfHosted: service.selfHosted,
      group: service.group,
      components: service.components,
      lineage,
      catalogRevision: result.catalogRevision,
    };
    const existing = await tx.service.findUnique({
      where: { id: service.id },
    });
    if (existing === null) {
      await tx.service.create({ data: { id: service.id, ...data } });
      result.services.created.push(service.id);
      continue;
    }
    requireForward(
      `Service ${service.id}`,
      existing.lifecycle,
      service.lifecycle,
    );
    if (existing.lineage !== lineage) {
      // A component-list change starts a new lineage and moves every
      // environment's binding generation (C4, E1, S1).
      await requireUnowned(tx, service.id, "A component-list change");
      await tx.environment.updateMany({
        where: { serviceId: service.id },
        data: { generation: { increment: 1 } },
      });
      result.services.lineageChanged.push(service.id);
    }
    await tx.service.update({ where: { id: service.id }, data });
  }
}

async function reconcileReferences(
  tx: Transaction,
  document: CatalogDocument,
  result: Result,
) {
  await tx.componentReference.deleteMany({});
  const rows = document.services.flatMap((service) =>
    service.components.flatMap((component) =>
      component.source === undefined
        ? []
        : [
            {
              serviceId: service.id,
              component: component.name,
              sourceServiceId: component.source.service,
              sourceComponent: component.source.component,
              mode: component.source.mode,
              sourceEnvironment: component.source.environment ?? null,
            },
          ],
    ),
  );
  await tx.componentReference.createMany({ data: rows });
  result.references = rows.length;
}

/** Recipe and configuration revisions are immutable once registered (P1, F1). */
async function reconcileRevisions(
  tx: Transaction,
  document: CatalogDocument,
  result: Result,
) {
  for (const recipe of document.recipes) {
    const existing = await tx.pipeline.findUnique({ where: { id: recipe.id } });
    if (existing === null) {
      await tx.pipeline.create({
        data: { id: recipe.id, definition: recipe.definition },
      });
      result.recipes.created.push(recipe.id);
    } else if (
      fingerprint(existing.definition) !== fingerprint(recipe.definition)
    )
      throw new DeliveryError(
        "CONFLICT",
        `Recipe revision ${recipe.id} already holds a different definition; add a new revision (P1)`,
      );
  }
  for (const configuration of document.configurations) {
    const existing = await tx.configuration.findUnique({
      where: { id: configuration.id },
    });
    if (existing === null) {
      await tx.configuration.create({ data: configuration });
      result.configurations.created.push(configuration.id);
    } else if (
      fingerprint(existing.content) !== fingerprint(configuration.content) ||
      fingerprint(existing.forwardOnly) !==
        fingerprint(configuration.forwardOnly)
    )
      throw new DeliveryError(
        "CONFLICT",
        `Configuration revision ${configuration.id} already holds different content; add a new revision (F1)`,
      );
  }
}

/** A renamed environment keeps its history and accepted selection (section 7). */
async function renameEnvironments(
  tx: Transaction,
  renames: Record<string, string>,
  result: Result,
) {
  for (const [from, to] of Object.entries(renames)) {
    const [source, target] = await Promise.all([
      tx.environment.findUnique({ where: { id: from } }),
      tx.environment.findUnique({ where: { id: to } }),
    ]);
    if (source === null) continue;
    if (target !== null)
      throw new DeliveryError(
        "CONFLICT",
        `Cannot rename ${from} onto existing environment ${to}`,
      );
    if (source.activeDeploymentId !== null)
      throw new DeliveryError(
        "CONFLICT",
        `Environment ${from} is owned by a deployment and cannot be renamed`,
      );
    await tx.environment.update({
      where: { id: from },
      data: {
        id: to,
        serviceId: environmentService(to),
        name: to.slice(to.indexOf("/") + 1),
      },
    });
    result.environments.renamed.push({ from, to });
  }
}

async function retireEnvironment(
  tx: Transaction,
  environmentId: string,
  result: Result,
) {
  const row = await tx.environment.findUnique({
    where: { id: environmentId },
  });
  if (row?.lifecycle !== "active") return;
  if (row.activeDeploymentId !== null)
    throw new DeliveryError(
      "CONFLICT",
      `Environment ${environmentId} is owned by a deployment and cannot retire (S3)`,
    );
  await tx.environment.update({
    where: { id: environmentId },
    // Retiring moves the binding generation (E1).
    data: { lifecycle: "retired", generation: { increment: 1 } },
  });
  result.environments.retired.push(environmentId);
}

async function upsertEnvironments(
  tx: Transaction,
  document: CatalogDocument,
  result: Result,
) {
  const recipes = new Map(
    document.recipes.map((recipe) => [recipe.id, recipe.definition]),
  );
  for (const environment of document.environments) {
    const definition = recipes.get(environment.recipeRevisionId);
    if (definition === undefined)
      throw new Error(
        `Catalog recipe ${environment.recipeRevisionId} vanished`,
      );
    const declared = {
      pipelineRevisionId: environment.recipeRevisionId,
      declaredConfigurationId: environment.configurationRevisionId,
      automatic: environment.automatic,
      promotionSourceEnvironmentId:
        environment.promotionSourceEnvironmentId ?? null,
      role: environment.role,
      approvalPolicy: environment.approvalPolicy,
      durableParentId: environment.durableParent ?? null,
      application: primaryApplication(definition),
    };
    const existing = await tx.environment.findUnique({
      where: { id: environment.id },
    });
    if (existing === null) {
      await tx.environment.create({
        data: {
          id: environment.id,
          serviceId: environmentService(environment.id),
          name: environment.id.slice(environment.id.indexOf("/") + 1),
          lifecycle: environment.lifecycle,
          ...declared,
        },
      });
      result.environments.created.push(environment.id);
      continue;
    }
    requireForward(
      `Environment ${environment.id}`,
      existing.lifecycle,
      environment.lifecycle,
    );
    if (
      existing.pipelineRevisionId !== declared.pipelineRevisionId ||
      existing.declaredConfigurationId !== declared.declaredConfigurationId
    )
      result.environments.rebound.push(environment.id);
    // Declaring a binding has no effect on any running system; only a
    // deployment moves the accepted selection (C3).
    await tx.environment.update({
      where: { id: environment.id },
      data: { ...declared, lifecycle: environment.lifecycle },
    });
    if (existing.lifecycle === "active" && environment.lifecycle !== "active")
      result.environments.retired.push(environment.id);
  }
}

/** C1: whatever the record holds beyond the catalog must be renamed or retired. */
async function retireOmitted(
  tx: Transaction,
  document: CatalogDocument,
  request: { retired: string[] },
  result: Result,
) {
  const declared = new Set(document.environments.map((env) => env.id));
  for (const environmentId of request.retired)
    await retireEnvironment(tx, environmentId, result);
  const omitted = await tx.environment.findMany({
    where: { id: { notIn: [...declared] }, lifecycle: "active" },
    select: { id: true },
  });
  if (omitted.length > 0)
    throw new DeliveryError(
      "CONFLICT",
      `The catalog omits active environments ${omitted.map((row) => row.id).join(", ")}; rename or retire them`,
    );
  const services = new Set(document.services.map((service) => service.id));
  for (const row of await tx.service.findMany({
    where: { id: { notIn: [...services] }, lifecycle: "active" },
  })) {
    await requireUnowned(tx, row.id, "Retiring an omitted service");
    await tx.service.update({
      where: { id: row.id },
      data: { lifecycle: "retired", catalogRevision: result.catalogRevision },
    });
    result.services.retired.push(row.id);
  }
}

async function reconcileEdges(
  tx: Transaction,
  document: CatalogDocument,
  result: Result,
) {
  await tx.prerequisiteEdge.deleteMany({});
  await tx.prerequisiteEdge.createMany({
    data: document.edges.map((edge) => ({
      dependentId: edge.dependent,
      prerequisiteId: edge.prerequisite,
      rule: edge.rule,
    })),
  });
  result.edges = document.edges.length;
}

/**
 * Make the record agree with one catalog document: services and their
 * component lists, references, immutable recipe and configuration
 * revisions, environments and their declared bindings, and edges. Nothing
 * here starts a deployment (C3).
 */
export async function reconcileCatalog(
  this: Delivery,
  raw: CatalogReconcileRequest,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const request = CatalogReconcileRequestSchema.parse(raw);
  const parsed = CatalogDocumentSchema.safeParse(request.document);
  if (!parsed.success)
    throw new DeliveryError(
      "INVALID",
      `Catalog document is invalid: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  const document = parsed.data;
  const result = emptyResult(await catalogRevision(document));
  await this.database.$transaction(
    async (tx) => {
      // Serialised with admission so a lineage change cannot race a claim.
      await lock(tx, "delivery:claim");
      await lock(tx, "catalog");
      await reconcileServices(tx, document, result);
      await reconcileReferences(tx, document, result);
      await reconcileRevisions(tx, document, result);
      await renameEnvironments(tx, request.renames, result);
      await upsertEnvironments(tx, document, result);
      await retireOmitted(tx, document, request, result);
      await reconcileEdges(tx, document, result);
      await audit(tx, actor, {
        action: "catalog.reconciled",
        entityId: result.catalogRevision,
        requestId: id(),
        metadata: result,
      });
    },
    { timeout: 120_000 },
  );
  return result;
}
