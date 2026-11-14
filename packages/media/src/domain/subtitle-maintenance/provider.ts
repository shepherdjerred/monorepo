import type { SubtitleTarget } from "#domain/subtitle-quality.ts";
import type {
  SubtitleMatchScoreV1,
  SubtitleScoreReferenceV1,
  SubtitleUpgradeV1,
  SubtitleCatalogEvidenceV1,
} from "#shared/subtitle-maintenance/score.ts";

export type SubtitleSource = {
  filename: string;
  description: string;
  bytes: Uint8Array<ArrayBuffer>;
  actualLanguage: string;
  forced: boolean | null;
  hearingImpaired: boolean | null;
  matchScoreV1?: SubtitleMatchScoreV1;
  catalogEvidenceV1?: SubtitleCatalogEvidenceV1;
  declaredEncoding?: "utf8" | "utf-16le" | "utf-16be" | "gb18030";
};
export type SubtitleSearch = SubtitleTarget & {
  operationId: string;
  assetIdV1?: string;
  sourceFilename: string;
  query: string;
  language: string;
  season?: number;
  episode?: number;
  scoreReferenceV1?: SubtitleScoreReferenceV1;
  excludedChecksumsV1?: readonly string[];
  excludedCandidatesV1?: readonly { providerId: string; candidateId: string }[];
  upgradeV1?: SubtitleUpgradeV1;
  /** Invocation-local capability; never a Workflow payload or persisted browser state. */
  downloadAuthority?: {
    authorize: () => Promise<void>;
    assertActive: () => void;
  };
};

export function subtitleProviderCandidateAllowedV1(
  search: Pick<SubtitleSearch, "excludedCandidatesV1">,
  providerId: string,
  candidateId: string,
): boolean {
  return (
    search.excludedCandidatesV1?.some(
      (entry) =>
        entry.providerId === providerId && entry.candidateId === candidateId,
    ) !== true
  );
}
