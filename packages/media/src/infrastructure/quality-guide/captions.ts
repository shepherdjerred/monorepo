import type { Prisma } from "#generated/prisma/client.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  canonicalLanguage,
  originalLanguageForMedia,
} from "#domain/quality-guide/language.ts";
import { defaultIntent } from "#shared/editions/scope.ts";

type CaptionProfile = { id: string; version: number; rules: Prisma.JsonValue };

type HouseholdTarget = {
  language: "en";
  forced: false;
  hearingImpaired: "any";
};

/** Bind automatic English captions to this title's assigned immutable profile,
 * never to the server's default or a different edition's request. */
export async function householdCaptionRequirements(
  tx: Prisma.TransactionClient,
  profile: CaptionProfile | null,
  originalLanguage: string | null,
  budget?: PublicationAuthorityReadBudget,
) {
  if (
    profile === null ||
    QualityRulesSchema.parse(profile.rules).resolved?.householdPolicy ===
      undefined
  )
    return {
      targets: new Array<HouseholdTarget>(),
      reasons: new Array<string>(),
      binding: null,
    };
  const snapshot = await tx.qualityProfileVersion.findUniqueOrThrow({
    where: {
      profileId_version: { profileId: profile.id, version: profile.version },
    },
  });
  budget?.consume(1);
  const rules = QualityRulesSchema.parse(snapshot.rules);
  const original =
    originalLanguage === null ? null : canonicalLanguage(originalLanguage);
  const enabled =
    rules.resolved?.householdPolicy?.englishCaptionsForForeignAudio === true;
  const targets: HouseholdTarget[] =
    enabled && original !== null && original !== "en"
      ? [{ language: "en", forced: false, hearingImpaired: "any" }]
      : [];
  return {
    targets,
    reasons:
      enabled && original === null
        ? ["subtitle_original_language_unknown"]
        : [],
    binding: {
      profileId: profile.id,
      profileVersion: profile.version,
      originalLanguage: original,
      enabled,
    },
  };
}

export function movieHouseholdCaptionRequirements(
  tx: Prisma.TransactionClient,
  input: {
    target: { profile: CaptionProfile | null } | null;
    coverage: { media: { originalLanguage: string | null } } | undefined;
  },
  budget: PublicationAuthorityReadBudget,
) {
  return householdCaptionRequirements(
    tx,
    input.target?.profile ?? null,
    input.coverage?.media.originalLanguage ?? null,
    budget,
  );
}

export function defaultHouseholdCaptionRequirements(
  tx: Prisma.TransactionClient,
  media: Parameters<typeof originalLanguageForMedia>[0] & {
    intents: readonly { edition: string; profile: CaptionProfile | null }[];
  },
) {
  return householdCaptionRequirements(
    tx,
    defaultIntent(media.intents)?.profile ?? null,
    originalLanguageForMedia(media),
  );
}
