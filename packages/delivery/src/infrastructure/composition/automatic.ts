import { z } from "zod";
import type { ArtifactVersion } from "#shared/contract.ts";
import {
  artifact,
  id,
  validateRequirements,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { lock } from "#infrastructure/delivery-records.ts";

const DeclaredComponentsSchema = z.array(
  z.object({ name: z.string().min(1) }).loose(),
);

/** The ordered component names a service declares for its current lineage (4.2). */
export function declaredComponents(components: unknown): string[] {
  return DeclaredComponentsSchema.parse(components).map((entry) => entry.name);
}

type OrderKey = { major: number; minor: number };
function compareKeys(left: OrderKey, right: OrderKey) {
  return left.major === right.major
    ? left.minor - right.minor
    : left.major - right.major;
}

/** The live set of a service: its automatic set revision of the current lineage with the highest order key (R4). */
export async function liveSet(tx: Transaction, serviceId: string) {
  const service = await tx.service.findUniqueOrThrow({
    where: { id: serviceId },
  });
  return tx.versionSet.findFirst({
    where: { serviceId, lineage: service.lineage, automatic: true },
    orderBy: [{ orderMajor: "desc" }, { orderMinor: "desc" }],
    include: { entries: true },
  });
}

/** The artifact a reference component takes from its source (A5). */
async function referencedArtifact(
  tx: Transaction,
  reference: {
    sourceServiceId: string;
    sourceComponent: string;
    mode: string;
    sourceEnvironment: string | null;
  },
): Promise<string | null> {
  if (reference.mode === "tracking") {
    const source = await tx.environment.findUnique({
      where: { id: reference.sourceEnvironment ?? "" },
    });
    if (source?.acceptedVersionSetRevisionId == null) return null;
    const entry = await tx.versionSetEntry.findUnique({
      where: {
        revisionId_component: {
          revisionId: source.acceptedVersionSetRevisionId,
          component: reference.sourceComponent,
        },
      },
    });
    return entry?.artifactId ?? null;
  }
  const live = await liveSet(tx, reference.sourceServiceId);
  return (
    live?.entries.find((entry) => entry.component === reference.sourceComponent)
      ?.artifactId ?? null
  );
}

export type AutomaticComposition = {
  serviceId: string;
  /** New and retained artifacts by component (B2). */
  outputs: Record<string, string>;
  orderKey: OrderKey;
} & (
  | { qualifiedBuildId: string; triggerDeploymentId?: undefined }
  | { triggerDeploymentId: string; qualifiedBuildId?: undefined }
);

type LiveSet = Awaited<ReturnType<typeof liveSet>>;

/** R4: a key below the live set's composes nothing. */
function behindLive(live: LiveSet, key: OrderKey) {
  return (
    live?.orderMajor != null &&
    live.orderMinor != null &&
    compareKeys({ major: live.orderMajor, minor: live.orderMinor }, key) > 0
  );
}

/** The outputs over the live set, within the declared list, references filled (A5). */
async function gatherComponents(
  tx: Transaction,
  input: AutomaticComposition,
  live: LiveSet,
  declared: string[],
) {
  // A service with no declared component list predates the catalog and
  // composes whatever its builds produce.
  const scope = (component: string) =>
    declared.length === 0 || declared.includes(component);
  const components: Record<string, string> = Object.fromEntries(
    [
      ...(live?.entries ?? []).map(
        (entry) => [entry.component, entry.artifactId] as const,
      ),
      ...Object.entries(input.outputs),
    ].filter(([component]) => scope(component)),
  );
  for (const reference of await tx.componentReference.findMany({
    where: { serviceId: input.serviceId },
  })) {
    if (components[reference.component] !== undefined) continue;
    const artifactId = await referencedArtifact(tx, reference);
    if (artifactId !== null) components[reference.component] = artifactId;
  }
  return components;
}

/** R2: equal to the live set in every digest composes nothing. */
async function unchangedFromLive(
  tx: Transaction,
  live: LiveSet,
  selected: Record<string, ArtifactVersion>,
) {
  if (live?.entries.length !== Object.keys(selected).length) return false;
  for (const entry of live.entries) {
    const original = await artifact(tx, entry.artifactId);
    if (selected[entry.component]?.digest !== original.digest) return false;
  }
  return true;
}

/**
 * Compose an automatic set revision (R0, R2, R4, R7, K1): the outputs over
 * the live set, reference components filled from their sources, nothing
 * when the order key is below the live set's, when a declared component is
 * still unfilled, or when every digest equals the live set's. A `requires`
 * violation throws INVALID so the caller fails the build visibly (A3).
 */
export async function composeAutomatic(
  tx: Transaction,
  input: AutomaticComposition,
) {
  await lock(tx, `versionSet:${input.serviceId}`);
  const service = await tx.service.findUniqueOrThrow({
    where: { id: input.serviceId },
  });
  const declared = declaredComponents(service.components);
  const live = await liveSet(tx, input.serviceId);
  if (behindLive(live, input.orderKey)) return null;
  const components = await gatherComponents(tx, input, live, declared);
  if (declared.some((component) => components[component] === undefined))
    return null;
  const selected: Record<string, ArtifactVersion> = {};
  for (const [component, artifactId] of Object.entries(components))
    selected[component] = await artifact(tx, artifactId);
  validateRequirements(selected);
  if (await unchangedFromLive(tx, live, selected)) return null;
  const highest = await tx.versionSet.aggregate({
    where: { serviceId: input.serviceId },
    _max: { revision: true },
  });
  return tx.versionSet.create({
    data: {
      id: id(),
      serviceId: input.serviceId,
      revision: (highest._max.revision ?? 0) + 1,
      baseRevisionId: live?.id ?? null,
      lineage: service.lineage,
      orderMajor: input.orderKey.major,
      orderMinor: input.orderKey.minor,
      automatic: true,
      qualifiedBuildId: input.qualifiedBuildId ?? null,
      triggerDeploymentId: input.triggerDeploymentId ?? null,
      entries: {
        create: Object.entries(components).map(([component, artifactId]) => ({
          component,
          artifactId,
        })),
      },
    },
  });
}

/**
 * The accepted artifact of every component a service tracks from the
 * accepting environment, grouped by the tracking service.
 */
async function trackedOutputs(
  tx: Transaction,
  accepted: { environmentId: string; versionSetRevisionId: string },
) {
  const references = await tx.componentReference.findMany({
    where: { mode: "tracking", sourceEnvironment: accepted.environmentId },
    orderBy: [{ serviceId: "asc" }, { component: "asc" }],
  });
  const outputs = new Map<string, Record<string, string>>();
  for (const reference of references) {
    const entry = await tx.versionSetEntry.findUnique({
      where: {
        revisionId_component: {
          revisionId: accepted.versionSetRevisionId,
          component: reference.sourceComponent,
        },
      },
    });
    if (entry === null) continue;
    outputs.set(reference.serviceId, {
      ...outputs.get(reference.serviceId),
      [reference.component]: entry.artifactId,
    });
  }
  return outputs;
}

/**
 * R7: when an environment accepts a selection, every service tracking one
 * of its components from that environment recomposes once in the same
 * transaction, ordered after its live set and before its next CI build.
 * All of a service's tracked components move together, so `requires`
 * holds against the accepted selection, never a half-updated mix.
 */
export async function recomposeTracking(
  tx: Transaction,
  accepted: { id: string; environmentId: string; versionSetRevisionId: string },
) {
  const composed: string[] = [];
  for (const [serviceId, outputs] of await trackedOutputs(tx, accepted)) {
    const live = await liveSet(tx, serviceId);
    const [sequence] = z
      .tuple([z.object({ value: z.number().int().positive() })])
      .parse(
        await tx.$queryRaw`SELECT nextval('"Build_registrationSequence_seq"')::int AS value`,
      );
    const row = await composeAutomatic(tx, {
      serviceId,
      outputs,
      // A service with no live set yet orders its first composition at zero.
      orderKey: { major: live?.orderMajor ?? 0, minor: sequence.value },
      triggerDeploymentId: accepted.id,
    });
    if (row !== null) composed.push(row.id);
  }
  return composed;
}
