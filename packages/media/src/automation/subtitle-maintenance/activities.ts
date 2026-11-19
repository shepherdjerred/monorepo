import type { MediaAutomationContext } from "#automation/context.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { serializable } from "#automation/store.ts";
import type { SubtitleMaintenanceActivitiesV1 } from "#shared/subtitle-maintenance/activities.ts";
import { maintenanceScopeV1, maintenanceWorkV1 } from "./work.ts";
import { planSubtitleTargetV1 } from "./planning.ts";
import { automaticSubtitleReplacementV1 } from "./replacement.ts";

export function subtitleMaintenanceActivitiesV1(
  context: MediaAutomationContext,
  enabled: () => Promise<boolean>,
): SubtitleMaintenanceActivitiesV1 {
  const replacements = automaticSubtitleReplacementV1(context, enabled);
  return {
    async listSubtitleMaintenanceV1({ cursor }) {
      if (!(await enabled()) || !(await context.gates.acquisition()))
        return { assetIds: [], nextCursor: null };
      const runtime = await runtimeAuthority(context.db);
      if (!runtime.active) return { assetIds: [], nextCursor: null };
      const assets = await context.db.libraryAsset.findMany({
        where: {
          owned: true,
          ownershipEpoch: runtime.epoch,
          state: "published",
          coverage: { some: { current: true } },
          ...(cursor === null ? {} : { id: { gt: cursor } }),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 26,
      });
      const page = assets.slice(0, 25);
      return {
        assetIds: page.map((asset) => asset.id),
        nextCursor: assets.length > 25 ? (page.at(-1)?.id ?? null) : null,
      };
    },
    async prepareSubtitleMaintenanceV1({ assetId, mode }) {
      if (!(await enabled()) || !(await context.gates.acquisition())) return [];
      const runtime = await runtimeAuthority(context.db);
      if (!runtime.active) return [];
      try {
        const resolved = await maintenanceScopeV1(context, assetId);
        return await serializable(context.db, async (tx) => {
          await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${assetId} FOR UPDATE`;
          const work = await maintenanceWorkV1(tx, {
            assetId,
            epoch: runtime.epoch,
            resolved,
          });
          if (work.protectedReasons.length > 0) return [];
          const jobs = [];
          for (const target of work.targets) {
            const job = await planSubtitleTargetV1(tx, {
              work,
              target,
              resolved,
              mode,
              epoch: runtime.epoch,
              now: context.now?.() ?? new Date(),
            });
            if (job !== null) jobs.push(job);
          }
          return jobs;
        });
      } catch (error) {
        if (!(error instanceof FileGuardError)) throw error;
        await context.db.applicationEvent.create({
          data: {
            kind: "subtitle_maintenance_protected",
            payload: { assetId, reason: error.reason },
          },
        });
        return [];
      }
    },
    beginAutomaticSubtitleReplacementV1: (input) => replacements.begin(input),
    approveAutomaticSubtitleReplacementV1: (input) =>
      replacements.approve(input),
  };
}
