import { z } from "zod";

export const PROVIDER_AVAILABILITY_MAX_AGE_MS = 30 * 60_000;
export const ProviderAvailabilitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.int().nonnegative(),
  providerId: z.string().min(1),
  providerReleaseId: z.string().min(1),
  seeders: z.int().nonnegative().nullable(),
  observedAt: z.iso.datetime(),
});
type Identity = { providerId: string; providerReleaseId: string };

export function nextProviderAvailability(
  previous: unknown,
  source: Identity & { seeders: number | null },
  observedAt: Date,
) {
  const current =
    previous == null ? null : ProviderAvailabilitySchema.parse(previous);
  if (
    current !== null &&
    (current.providerId !== source.providerId ||
      current.providerReleaseId !== source.providerReleaseId)
  )
    throw new Error("Availability observation has another source identity");
  if (
    current !== null &&
    (Date.parse(current.observedAt) > observedAt.getTime() ||
      (Date.parse(current.observedAt) === observedAt.getTime() &&
        current.seeders === source.seeders))
  )
    return null;
  return ProviderAvailabilitySchema.parse({
    providerId: source.providerId,
    providerReleaseId: source.providerReleaseId,
    seeders: source.seeders,
    schemaVersion: 1,
    version: (current?.version ?? 0) + 1,
    observedAt: observedAt.toISOString(),
  });
}

export function observedProviderSeeders(
  value: unknown,
  identity: Identity,
  now: number,
): number | null {
  const observation = ProviderAvailabilitySchema.parse(value);
  if (
    observation.providerId !== identity.providerId ||
    observation.providerReleaseId !== identity.providerReleaseId
  )
    throw new Error("Availability observation has another source identity");
  const age = now - Date.parse(observation.observedAt);
  return age < 0 || age > PROVIDER_AVAILABILITY_MAX_AGE_MS
    ? null
    : observation.seeders;
}
