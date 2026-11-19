import type { Database } from "#infrastructure/database.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import type {
  QualityGuideActivities,
  QualityGuideKind,
} from "#shared/quality-guide/contract.ts";
import type { TrashGuideClient } from "#integrations/trash-guide/client.ts";
import type { GuideBundle } from "#domain/quality-guide/contract.ts";
import { compileQualityGuide } from "#domain/quality-guide/compile.ts";
import { MediaError } from "#application/errors.ts";
import { saveCompiledGuide } from "#infrastructure/quality-guide/persistence.ts";
import { serializable } from "#automation/store.ts";

type Outcome = "updated" | "unchanged" | "deferred" | "failed";

function bundleFor(
  bundles: Map<QualityGuideKind, Promise<GuideBundle>>,
  guide: Pick<TrashGuideClient, "load">,
  kind: QualityGuideKind,
  signal?: AbortSignal,
) {
  let bundle = bundles.get(kind);
  if (bundle === undefined) {
    bundle = guide.load(kind, signal);
    bundles.set(kind, bundle);
  }
  return bundle;
}

/** Each selected profile is committed atomically after all remote definitions
 * validate. A bad guide never replaces the last usable immutable version. */
export function qualityGuideActivities(
  db: Database,
  guide: Pick<TrashGuideClient, "load">,
) {
  return {
    async refreshMediaQualityGuides(
      signal?: AbortSignal,
    ): ReturnType<QualityGuideActivities["refreshMediaQualityGuides"]> {
      signal?.throwIfAborted();
      const profiles = await db.qualityProfile.findMany({
        where: {
          rules: { path: ["managedGuide", "preset"], equals: "living-room-v1" },
        },
        orderBy: { id: "asc" },
        take: 26,
      });
      if (profiles.length > 25)
        throw new Error(
          "Managed quality profile count exceeds the selected-guide contract",
        );
      const bundles = new Map<QualityGuideKind, Promise<GuideBundle>>();
      const counts = { updated: 0, unchanged: 0, deferred: 0, failed: 0 };
      for (const profile of profiles) {
        signal?.throwIfAborted();
        const managed = QualityRulesSchema.parse(profile.rules).managedGuide;
        if (managed === undefined)
          throw new Error("Selected guide profile lost its source contract");
        let compiled: ReturnType<typeof compileQualityGuide>;
        try {
          compiled = compileQualityGuide(
            managed.kind,
            await bundleFor(bundles, guide, managed.kind, signal),
            managed.scoreOverrides,
          );
        } catch {
          signal?.throwIfAborted();
          await event(db, profile.id, {
            status: "failed",
            revision: null,
            reason: "guide_fetch_or_validation_failed",
          });
          counts.failed++;
          continue;
        }
        const next = compiled.rules.managedGuide;
        if (next === undefined)
          throw new Error("Compiled guide lost its source contract");
        signal?.throwIfAborted();
        if (next.contentHash === managed.contentHash) {
          await event(db, profile.id, {
            status: "unchanged",
            revision: next.revision,
            reason: null,
          });
          counts.unchanged++;
          continue;
        }
        const outcome = await applyUpdate(
          db,
          {
            profileId: profile.id,
            expectedVersion: profile.version,
            compiled,
            revision: next.revision,
          },
          signal,
        );
        counts[outcome]++;
      }
      return counts;
    },
  };
}

function event(
  db: Pick<Database, "applicationEvent">,
  profileId: string,
  outcome: { status: Outcome; revision: string | null; reason: string | null },
) {
  return db.applicationEvent.create({
    data: {
      kind: "quality_guide_sync",
      payload: { schemaVersion: 1, profileId, ...outcome },
    },
  });
}

async function applyUpdate(
  db: Database,
  input: {
    profileId: string;
    expectedVersion: number;
    compiled: ReturnType<typeof compileQualityGuide>;
    revision: string;
  },
  signal?: AbortSignal,
): Promise<"updated" | "deferred"> {
  try {
    await serializable(db, async (tx) => {
      signal?.throwIfAborted();
      await saveCompiledGuide(tx, { ...input, create: false });
      await event(tx, input.profileId, {
        status: "updated",
        revision: input.revision,
        reason: null,
      });
      signal?.throwIfAborted();
    });
    return "updated";
  } catch (error) {
    if (
      !(error instanceof MediaError) ||
      !["quality_guide_acquisition_active", "version_conflict"].includes(
        error.code,
      )
    )
      throw error;
    signal?.throwIfAborted();
    await event(db, input.profileId, {
      status: "deferred",
      revision: input.revision,
      reason: error.code,
    });
    return "deferred";
  }
}
