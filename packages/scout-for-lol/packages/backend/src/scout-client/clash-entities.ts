import { z } from "zod";
import {
  PlatformRouteSchema,
  clashIsoWeekKey,
  type ScoutClientObservation,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";

const IdSchema = z
  .union([z.string().min(1).max(128), z.number().int().positive()])
  .transform(String);
const PayloadSchema = z.object({
  resource: z.string(),
  data: z
    .object({ id: IdSchema.optional(), tournamentId: IdSchema.optional() })
    .loose(),
});
const ENTITY_RESOURCES = new Set([
  "clash_roster",
  "clash_roster_stats",
  "clash_bracket",
  "clash_tournament",
]);

/** Only resource-specific top-level identity can address an entity. */
export function observedClashEntity(payload: unknown) {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const [resource, addressedId, extra] = parsed.data.resource.split(":");
  if (
    resource === undefined ||
    extra !== undefined ||
    !ENTITY_RESOURCES.has(resource)
  )
    return null;
  const entityId = parsed.data.data.id ?? addressedId;
  if (entityId === undefined || entityId.length === 0) return null;
  if (addressedId !== undefined && addressedId !== entityId) return null;
  return {
    resource,
    entityId,
    tournamentId:
      resource === "clash_tournament"
        ? entityId
        : (parsed.data.data.tournamentId ?? null),
    isPrimary: resource === "clash_roster" && addressedId === undefined,
  };
}

export async function projectClashEntity(
  observation: ScoutClientObservation,
): Promise<void> {
  if (observation.kind !== "clash" || observation.localPuuid === undefined)
    return;
  const entity = observedClashEntity(observation.payload);
  const platform = PlatformRouteSchema.safeParse(observation.platformId);
  if (entity === null || !platform.success) return;
  // An observation-week bucket retains reused IDs without inventing a cup identity.
  const tournamentKey =
    entity.tournamentId ??
    `observed:${clashIsoWeekKey(observation.capturedAt.slice(0, 10))}`;
  await prisma.$executeRaw`
    INSERT INTO "ScoutClientClashEntity"
      ("observerPuuid", "platformId", resource, "entityId", "tournamentId", "tournamentKey", "isPrimary", "observationId", "capturedAt")
    VALUES (${observation.localPuuid}, ${platform.data}, ${entity.resource}, ${entity.entityId}, ${entity.tournamentId}, ${tournamentKey}, ${entity.isPrimary}, ${observation.observationId}, ${new Date(observation.capturedAt)})
    ON CONFLICT ("observerPuuid", "platformId", resource, "entityId", "tournamentKey") DO UPDATE SET
      "tournamentId" = COALESCE(EXCLUDED."tournamentId", "ScoutClientClashEntity"."tournamentId"),
      "isPrimary" = EXCLUDED."isPrimary" OR "ScoutClientClashEntity"."isPrimary",
      "observationId" = EXCLUDED."observationId",
      "capturedAt" = EXCLUDED."capturedAt"
    WHERE (EXCLUDED."capturedAt", EXCLUDED."observationId") >
      ("ScoutClientClashEntity"."capturedAt", "ScoutClientClashEntity"."observationId")
  `;
}
