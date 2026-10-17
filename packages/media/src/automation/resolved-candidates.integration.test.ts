import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { searchCandidates, loadProfile } from "./acquisition-candidates.ts";
import { importResolvedProfiles } from "#migration/profile-import.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import {
  QualityRulesSchema,
  PublicReleaseAttributesSchema,
} from "#shared/api.ts";
import { persistCandidateSnapshot } from "./candidate-evidence.ts";
import { StoredCandidateSchema } from "./providers.ts";

const { database, context, fixture } = automationTestHarness();
test("candidate selection persists source evidence and refreshes only unclaimed immutable identities", async () => {
  const f = await fixture();
  const db = database();
  const intent = await db.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.media.id)),
    include: { profile: true },
  });
  if (intent.profile === null) throw new Error("Fixture profile missing");
  const resolved = importResolvedProfiles(snapshot)[0]?.profiles.find(
    (profile) => profile.profile.name === "Best Available",
  );
  if (resolved === undefined) throw new Error("Source fixture missing");
  for (const definition of resolved.qualityDefinitions) {
    definition.minSize = 0;
    definition.maxSize = 0;
  }
  const rules = { ...QualityRulesSchema.parse(intent.profile.rules), resolved };
  await db.qualityProfile.update({
    where: { id: intent.profile.id },
    data: { rules, version: 1 },
  });
  await db.qualityProfileVersion.create({
    data: { profileId: intent.profile.id, version: 1, rules },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { originalLanguage: "en", runtimeMinutes: 90 },
  });
  const profile = await loadProfile(db, f.media.id);
  if (profile === null) throw new Error("Profile missing");
  const source = StoredCandidateSchema.parse({
    ...f.source,
    providerReleaseId: crypto.randomUUID(),
    title: "Example.2020.1080p.WEB-DL.H264.English-GROUP",
  });
  const ctx = context();
  ctx.providers = {
    withProvider: async (_providerId, work) =>
      await work({ search: () => Promise.resolve([source]) }),
  };
  const selected = await searchCandidates(ctx, f.media.id, profile);
  expect(selected).toHaveLength(1);
  const selectedId = selected[0];
  if (selectedId === undefined) throw new Error("Candidate missing");
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: { id: selectedId },
  });
  const attributes = {
    id: release.id,
    title: release.title,
    providerId: release.providerId,
    ...PublicReleaseAttributesSchema.parse(release.attributes),
  };
  expect(attributes.resolvedEvidence?.release).toMatchObject({
    qualityId: 3,
    originalLanguage: "en",
    runtimeMinutes: 90,
  });
  await db.releaseCandidate.update({
    where: { id: release.id },
    data: {
      attributes: PublicReleaseAttributesSchema.omit({
        resolvedEvidence: true,
      }).parse(attributes),
    },
  });
  expect(await searchCandidates(ctx, f.media.id, profile)).toEqual(selected);
  const request = await db.mediaRequest.findFirstOrThrow({
    where: { mediaId: f.media.id },
  });
  await db.acquisitionAttempt.create({
    data: {
      releaseId: release.id,
      sponsorRequestId: request.id,
      mediaIds: [f.media.id],
      generations: { [f.media.id]: 1 },
      operationId: crypto.randomUUID(),
      state: "reserved",
    },
  });
  const changed = structuredClone(attributes);
  if (changed.resolvedEvidence === undefined)
    throw new Error("Evidence missing");
  changed.resolvedEvidence.release.runtimeMinutes = 1;
  const evaluation = { accepted: true, reasons: [], qualityRank: 0, score: 0 };
  const preserved = await persistCandidateSnapshot(ctx, {
    source,
    attributes: changed,
    evaluation,
  });
  expect(preserved?.resolvedEvidence?.release.runtimeMinutes).toBe(90);
  const incompatible = { ...attributes, title: "Different movie" };
  const unchanged = await persistCandidateSnapshot(ctx, {
    source: { ...source, title: incompatible.title },
    attributes: incompatible,
    evaluation,
  });
  expect(unchanged).toBeNull();
});
