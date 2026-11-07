import { BuildSummarySchema } from "#shared/contract.ts";
import { changeDomain } from "#shared/hub/change-contract.ts";
import type {
  ActivityEntry,
  AppTarget,
  BuildView,
  ServiceSummary,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import { wire } from "#infrastructure/delivery-records.ts";
import { index } from "#infrastructure/delivery-data.ts";
import {
  CATALOG_CORE,
  type CatalogCore,
  catalogService,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { buildLinks, opsLinks } from "./links.ts";

type BuildRow = Prisma.BuildGetPayload<object>;
type AuditRow = Prisma.AuditGetPayload<object>;

export function buildView(row: BuildRow): BuildView {
  const summary = BuildSummarySchema.parse(wire(row));
  return {
    ...summary,
    pipelineNumber: row.pipelineNumber,
    links: buildLinks({ ...summary, pipelineNumber: row.pipelineNumber }),
  };
}

/**
 * A service's title, kind and ops links. A v1 service keeps its ops-model
 * entry; a service only the v2 catalog declares reads its own ops attributes,
 * taking its group's kind when it declares none.
 */
export function serviceSummary(
  serviceId: string,
  catalog: CatalogCore = CATALOG_CORE,
): ServiceSummary {
  const service = index.byId(serviceId);
  if (service?.id === serviceId)
    return {
      id: service.id,
      title: service.title,
      kind: service.kind,
      links: opsLinks(service),
    };
  const declared = catalogService(serviceId, catalog);
  if (declared === undefined)
    throw new DeliveryError("NOT_FOUND", "Service not found");
  const group = catalog.groups.find((entry) => entry.id === declared.group);
  if (group === undefined)
    throw new Error(
      `Catalog service ${serviceId} names unknown group ${declared.group}`,
    );
  return {
    id: declared.id,
    title: declared.title,
    kind: declared.ops?.kind ?? group.kind,
    links: declared.ops === undefined ? [] : opsLinks(declared.ops),
  };
}

function activityTarget(row: AuditRow): AppTarget | null {
  switch (changeDomain(row.action)) {
    case "deployment": {
      return { kind: "deployment", id: row.entityId };
    }
    case "build": {
      return { kind: "build", id: row.entityId };
    }
    case "versionSet": {
      return { kind: "versionSet", id: row.entityId };
    }
    case "environment": {
      return { kind: "environment", id: row.entityId };
    }
    case "artifact":
    case "catalog":
    case "monitor":
    case "content":
    case "control_plane":
    case "forum":
    case "minecraft":
    case "pipeline":
    case "platform":
    case "snapshot":
    case "trmnl":
    case "worker": {
      return null;
    }
  }
}

export function activityEntry(row: AuditRow): ActivityEntry {
  const metadata =
    row.metadata !== null &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityId: row.entityId,
    requestId: row.requestId,
    metadata,
    occurredAt: row.occurredAt.toISOString(),
    target: activityTarget(row),
  };
}
