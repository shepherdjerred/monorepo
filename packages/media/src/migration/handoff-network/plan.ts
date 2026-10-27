import { defaultIntent } from "#shared/editions/scope.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { HandoffScopeProtocolSchema } from "#shared/handoff/protocol.ts";
import { assertLibraryHandoffSnapshot } from "#infrastructure/handoff/scoped-snapshot.ts";
import {
  BundleReportSchema,
  MigrationSelectionSchema,
} from "#shared/migration-handoff.ts";
import { MigrationBundleProtocolSchema } from "#shared/handoff/library-bundle.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { protectedEvidence } from "./context.ts";
import { selectedHandoffEntries } from "#infrastructure/handoff/selection.ts";

export async function readHandoffPlan(
  db: Prisma.TransactionClient,
  planId: string,
) {
  const plan = await db.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { bundleReview: { include: { bundle: true } } },
  });
  const scope = HandoffScopeProtocolSchema.parse(plan.scope);
  const manifest = MigrationBundleProtocolSchema.parse(
    plan.bundleReview.bundle.manifest,
  );
  const report = BundleReportSchema.parse(plan.bundleReview.report);
  const approved = MigrationSelectionSchema.parse(plan.bundleReview.selection);
  assertReview({ plan, scope, manifest, report, approved });
  await selectedHandoffEntries(db, {
    report,
    approved,
    selected: scope.request.selected,
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const authority = await runtimeAuthority(db);
  if (
    !["preparing", "awaiting_review", "applying"].includes(plan.state) ||
    plan.recoveryEpoch !== runtime.recoveryEpoch ||
    plan.runtimeVersion !== runtime.version
  )
    throw protectedEvidence("handoff_runtime_changed");
  const validMode =
    scope.request.activation === "activate"
      ? runtime.mode === "observe" && !runtime.ownershipConfirmed
      : authority.active;
  if (!validMode) throw protectedEvidence("handoff_runtime_changed");
  await assertLibraryHandoffSnapshot(db, scope);
  const media = await db.mediaItem.findMany({
    where: { id: { in: scope.media.map((item) => item.mediaId) } },
    include: {
      intents: { where: { edition: "default" } },
      parent: { include: { parent: true } },
    },
  });
  if (media.length !== scope.media.length)
    throw protectedEvidence("handoff_media_missing");
  for (const expected of scope.media) {
    const current = media.find((item) => item.id === expected.mediaId);
    if (
      current?.version !== expected.version ||
      (defaultIntent(current.intents)?.generation ?? null) !==
        expected.generation
    )
      throw protectedEvidence("handoff_media_changed");
  }
  for (const binding of scope.request.profiles) {
    const profile = await db.qualityProfile.findUnique({
      where: { id: binding.profileId },
    });
    if (profile?.version !== binding.version)
      throw protectedEvidence("handoff_profile_changed");
  }
  return { plan, scope, manifest, report, media };
}
function assertReview(input: {
  plan: Prisma.MediaHandoffPlanGetPayload<{
    include: { bundleReview: { include: { bundle: true } } };
  }>;
  scope: ReturnType<typeof HandoffScopeProtocolSchema.parse>;
  manifest: ReturnType<typeof MigrationBundleProtocolSchema.parse>;
  report: ReturnType<typeof BundleReportSchema.parse>;
  approved: ReturnType<typeof MigrationSelectionSchema.parse>;
}) {
  const { plan, scope, manifest, report } = input;
  if (
    plan.bundleReview.status !== "approved" ||
    plan.bundleReview.version !== plan.bundleReviewVersion ||
    plan.bundleReview.reportHash !== scope.request.reportHash ||
    manifest.bundleHash !== scope.request.bundleHash ||
    !manifest.complete ||
    !manifest.stable ||
    !report.complete ||
    !report.stable
  )
    throw protectedEvidence("handoff_review_changed");
  if (snapshotHash(scope.request) !== plan.requestHash)
    throw new Error("Persisted handoff request hash mismatch");
  if (
    scope.request.bundleReviewId !== plan.bundleReviewId ||
    scope.request.bundleReviewVersion !== plan.bundleReviewVersion ||
    scope.request.recoveryEpoch !== plan.recoveryEpoch ||
    scope.request.runtimeVersion !== plan.runtimeVersion ||
    report.bundleHash !== manifest.bundleHash
  )
    throw protectedEvidence("handoff_binding_changed");
}
export type LoadedHandoffPlan = Awaited<ReturnType<typeof readHandoffPlan>>;
