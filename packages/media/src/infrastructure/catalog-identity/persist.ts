import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { CatalogIdentity } from "#shared/acquisition/catalog.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { mergeCatalogIdentity } from "./catalog.ts";

export async function persistCatalogMedia(
  tx: Prisma.TransactionClient,
  input: {
    kind: "movie" | "series";
    tmdbId: number;
    title: string;
    year: number | null;
    originalLanguage: string;
    runtimeMinutes: number | null;
    identity: CatalogIdentity;
  },
) {
  const existing = await tx.mediaItem.findUnique({
    where: { kind_tmdbId: { kind: input.kind, tmdbId: input.tmdbId } },
  });
  if (existing !== null) await lockAcquisitionMedia(tx, [existing.id]);
  const current =
    existing === null
      ? null
      : await tx.mediaItem.findUniqueOrThrow({ where: { id: existing.id } });
  const fields = {
    title: input.title,
    year: input.year,
    originalLanguage: input.originalLanguage,
    runtimeMinutes: input.runtimeMinutes,
    externalIds: mergeCatalogIdentity(
      current?.externalIds ?? {},
      input.identity,
      input,
    ),
  };
  if (current === null)
    return await tx.mediaItem.create({
      data: {
        kind: input.kind,
        tmdbId: input.tmdbId,
        ...fields,
        ...(input.kind === "series" ? { catalogState: "pending" } : {}),
      },
    });
  const previous = {
    title: current.title,
    year: current.year,
    originalLanguage: current.originalLanguage,
    runtimeMinutes: current.runtimeMinutes,
    externalIds: current.externalIds,
  };
  if (snapshotHash(z.json().parse(previous)) === snapshotHash(fields))
    return current;
  return await tx.mediaItem.update({
    where: { id: current.id },
    data: { ...fields, version: { increment: 1 } },
  });
}
