import type { Prisma } from "#generated/prisma/client.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { composeAutomatic } from "./automatic.ts";

type BuildRow = Prisma.BuildGetPayload<object>;

/** Outputs of a CI build: its new and retained artifacts by component (B2). */
async function ciOutputs(tx: Transaction, build: BuildRow) {
  const outputs = await tx.buildArtifactSelection.findMany({
    where: { buildId: build.id },
  });
  return Object.fromEntries(
    outputs.map((entry) => [entry.component, entry.artifactId]),
  );
}

/** Outputs of an acquisition or attested build: the artifacts it registered. */
async function registeredOutputs(tx: Transaction, build: BuildRow) {
  const artifacts = await tx.artifact.findMany({
    where: { buildId: build.id },
  });
  return Object.fromEntries(
    artifacts.map((entry) => [entry.component, entry.id]),
  );
}

/** A newer verified build of the same ordered kind already stands for the service (R4). */
async function supersededInPipeline(tx: Transaction, build: BuildRow) {
  const newer = await tx.build.findFirst({
    where: {
      serviceId: build.serviceId,
      repositoryId: build.repositoryId,
      status: "verified",
      sourceKind: build.sourceKind,
      pipelineNumber: { gt: build.pipelineNumber ?? 0 },
    },
  });
  return newer !== null;
}

/**
 * One pipeline registers several builds for a service: each acquisition and
 * the grouped CI publication after them. Keying all of them on the pipeline
 * alone would give their sets equal order keys and an ambiguous live set, so
 * the registration sequence orders them within the pipeline (B4, R4).
 */
function pipelineKey(build: BuildRow, pipelineNumber: number) {
  if (build.registrationSequence === null)
    throw new Error(`Build ${build.id} is missing its registration sequence`);
  return { major: pipelineNumber, minor: build.registrationSequence };
}

/**
 * The automatic set a verified build composes (R0, R2, B4). CI and
 * acquisition builds key on their pipeline number, then their registration
 * within it; an attested build keys after the newest set of its service,
 * ordered by registration. A
 * licensed-bundle build is the v1 form of attestation and composes nothing;
 * an acquisition outside CI has no order key and is selected explicitly.
 */
export async function composeVerifiedBuild(tx: Transaction, build: BuildRow) {
  switch (build.sourceKind) {
    case "ci": {
      if (build.pipelineNumber === null)
        throw new Error("CI build is missing its pipeline number");
      // A newer verified build already stands for this service even when it
      // composed nothing because its digests equalled the live set (R2, R4).
      if (await supersededInPipeline(tx, build)) return null;
      return composeAutomatic(tx, {
        serviceId: build.serviceId,
        outputs: await ciOutputs(tx, build),
        orderKey: pipelineKey(build, build.pipelineNumber),
        qualifiedBuildId: build.id,
      });
    }
    case "upstream": {
      if (build.pipelineNumber === null) return null;
      if (await supersededInPipeline(tx, build)) return null;
      return composeAutomatic(tx, {
        serviceId: build.serviceId,
        outputs: await registeredOutputs(tx, build),
        orderKey: pipelineKey(build, build.pipelineNumber),
        qualifiedBuildId: build.id,
      });
    }
    case "attested": {
      if (build.registrationSequence === null)
        throw new Error("Attested build is missing its registration sequence");
      const newest = await tx.versionSet.aggregate({
        where: { serviceId: build.serviceId },
        _max: { orderMajor: true },
      });
      return composeAutomatic(tx, {
        serviceId: build.serviceId,
        outputs: await registeredOutputs(tx, build),
        orderKey: {
          major: newest._max.orderMajor ?? 0,
          minor: build.registrationSequence,
        },
        qualifiedBuildId: build.id,
      });
    }
    case "licensed-bundle":
      return null;
    // Catalog reconcile records the carried set itself (section 7).
    case "migrated":
      return null;
    default:
      throw new Error(`Unknown build source kind ${build.sourceKind}`);
  }
}
