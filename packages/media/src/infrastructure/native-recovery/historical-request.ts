import type { MediaRequest, Prisma } from "#generated/prisma/client.ts";
import { assertDefaultEdition } from "#shared/editions/scope.ts";

/** The original household wire predates movie choice storage. Keep its exact key order. */
export const historicalRequestSelect = {
  id: true,
  userId: true,
  mediaId: true,
  edition: true,
  active: true,
  direct: true,
  excluded: true,
  coverageCompletedAt: true,
  subtitleLanguages: true,
  includeFutureEpisodes: true,
  includeSpecials: true,
  sponsorRequestId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MediaRequestSelect;

export function historicalRequest(
  row: Pick<MediaRequest, keyof typeof historicalRequestSelect>,
) {
  assertDefaultEdition(row.edition);
  return {
    id: row.id,
    userId: row.userId,
    mediaId: row.mediaId,
    active: row.active,
    direct: row.direct,
    excluded: row.excluded,
    coverageCompletedAt: row.coverageCompletedAt,
    subtitleLanguages: row.subtitleLanguages,
    includeFutureEpisodes: row.includeFutureEpisodes,
    includeSpecials: row.includeSpecials,
    sponsorRequestId: row.sponsorRequestId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
