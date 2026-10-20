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
import { buildLinks, serviceLinks } from "./links.ts";

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

export function serviceSummary(serviceId: string): ServiceSummary {
  const service = index.byId(serviceId);
  if (service?.id !== serviceId)
    throw new DeliveryError("NOT_FOUND", "Service not found");
  return {
    id: service.id,
    title: service.title,
    kind: service.kind,
    links: serviceLinks(service),
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
