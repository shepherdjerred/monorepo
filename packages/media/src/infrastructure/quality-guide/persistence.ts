import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { compileQualityGuide } from "#domain/quality-guide/compile.ts";

export type CompiledGuide = ReturnType<typeof compileQualityGuide>;

/** Policy edits do not alter files or bump attempt generations. Active
 * reservations must drain before moving the current immutable profile pointer. */
export async function saveCompiledGuide(
  tx: Prisma.TransactionClient,
  input: {
    profileId: string;
    expectedVersion: number;
    compiled: CompiledGuide;
    create: boolean;
  },
) {
  const { profileId, expectedVersion, compiled } = input;
  await tx.$queryRaw`SELECT id FROM "QualityProfile" WHERE id=${profileId} FOR UPDATE`;
  const existing = await tx.qualityProfile.findUnique({
    where: { id: profileId },
  });
  if (
    (existing === null) !== input.create ||
    (existing?.version ?? 0) !== expectedVersion
  )
    throw new MediaError(
      "version_conflict",
      "The profile changed; review the current version",
      409,
    );
  if (
    existing !== null &&
    (await tx.acquisitionReservation.findFirst({
      where: { target: { profileId } },
      select: { attemptId: true },
    })) !== null
  )
    throw new MediaError(
      "quality_guide_acquisition_active",
      "Current downloads retain their immutable profile; the update will apply after they settle",
      409,
    );
  const version = expectedVersion + 1;
  await tx.qualityProfile.upsert({
    where: { id: profileId },
    create: {
      id: profileId,
      name: compiled.name,
      version,
      rules: compiled.rules,
    },
    update: { name: compiled.name, version, rules: compiled.rules },
  });
  await tx.qualityProfileVersion.create({
    data: { profileId, version, rules: compiled.rules },
  });
  return { profileId, version, status: "completed" as const };
}
