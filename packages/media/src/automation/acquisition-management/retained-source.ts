import type { ReleaseCandidate } from "#generated/prisma/client.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
import { candidateSourceIdentity } from "#automation/candidate-evidence.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";

type RetainedRelease = Pick<
  ReleaseCandidate,
  "providerId" | "providerReleaseId" | "title" | "attributes"
>;

export function readRetainedProviderSource(
  cipher: CredentialCipher,
  encryptedSource: string,
  release: RetainedRelease,
) {
  return StoredCandidateSchema.parse(
    JSON.parse(
      cipher.decrypt(
        encryptedSource,
        `release:${release.providerId}:${release.providerReleaseId}`,
      ),
    ),
  );
}

export function retainedProviderSourceMatches(
  source: ProviderCandidate,
  release: RetainedRelease,
  observedSource?: ProviderCandidate,
) {
  return (
    source.providerId === release.providerId &&
    source.providerReleaseId === release.providerReleaseId &&
    source.title === release.title &&
    source.sizeBytes ===
      PublicReleaseAttributesSchema.parse(release.attributes).sizeBytes &&
    (observedSource === undefined ||
      candidateSourceIdentity(source) ===
        candidateSourceIdentity(observedSource))
  );
}
