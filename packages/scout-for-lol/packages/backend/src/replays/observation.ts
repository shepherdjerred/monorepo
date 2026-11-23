import {
  ReplayPatchObservationSchema,
  type ReplayPatchObservation,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { prisma } from "#src/database/index.ts";
import { observeReplayPatch } from "./upstream.ts";

export type ReplayObservationProgress = {
  readonly phase: "observing" | "persisted";
  readonly platformId: string;
};
type ObservationDependencies = {
  readonly platforms: () => Promise<string[]>;
  readonly observe: typeof observeReplayPatch;
  readonly persist: (observation: ReplayPatchObservation) => Promise<boolean>;
};

/** Older or duplicate Activity completions cannot overwrite a newer observation. */
export async function persistReplayPatchObservation(
  input: ReplayPatchObservation,
  database: Pick<typeof prisma, "$executeRaw"> = prisma,
): Promise<boolean> {
  const observation = ReplayPatchObservationSchema.parse(input);
  const changed = await database.$executeRaw`
    INSERT INTO "ReplayPatchObservation"
      ("platformId", "patch", "gameBuild", "sourceUrl", "sourceSha256", "observedAt")
    VALUES (${observation.platformId}, ${observation.patch}, ${observation.gameBuild},
      ${observation.sourceUrl}, ${observation.sourceSha256}, ${new Date(observation.observedAt)})
    ON CONFLICT ("platformId") DO UPDATE SET
      "patch" = EXCLUDED."patch", "gameBuild" = EXCLUDED."gameBuild",
      "sourceUrl" = EXCLUDED."sourceUrl", "sourceSha256" = EXCLUDED."sourceSha256",
      "observedAt" = EXCLUDED."observedAt"
    WHERE "ReplayPatchObservation"."observedAt" < EXCLUDED."observedAt"
  `;
  if (changed !== 0 && changed !== 1)
    throw new Error(
      "Replay observation persistence changed an unexpected number of platforms",
    );
  return changed === 1;
}

const dependencies: ObservationDependencies = {
  async platforms() {
    const rows = await prisma.scoutClientReplayArtifact.findMany({
      where: { uploadState: "COMPLETED", platformId: { not: null } },
      distinct: ["platformId"],
      select: { platformId: true },
      orderBy: { platformId: "asc" },
    });
    return rows.flatMap((row) =>
      row.platformId === null ? [] : [row.platformId],
    );
  },
  observe: observeReplayPatch,
  persist: persistReplayPatchObservation,
};

/** Two bounded upstream reads at a time; independent regions continue on failure. */
export async function refreshReplayPatchObservations(
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ReplayObservationProgress) => void;
    dependencies?: ObservationDependencies;
  } = {},
): Promise<{ platforms: number; updated: number; unchanged: number }> {
  const deps = options.dependencies ?? dependencies;
  const platforms = [...new Set(await deps.platforms())];
  const summary = { platforms: platforms.length, updated: 0, unchanged: 0 };
  const failures: unknown[] = [];
  let next = 0;
  async function worker() {
    for (;;) {
      options.signal?.throwIfAborted();
      const platformId = platforms[next++];
      if (platformId === undefined) return;
      try {
        options.onProgress?.({ phase: "observing", platformId });
        const observation = await deps.observe(
          platformId,
          options.signal === undefined ? {} : { signal: options.signal },
        );
        options.signal?.throwIfAborted();
        if (observation.platformId !== platformId)
          throw new Error(
            "Official release observation returned a different platform",
          );
        if (await deps.persist(observation)) summary.updated += 1;
        else summary.unchanged += 1;
        options.onProgress?.({ phase: "persisted", platformId });
      } catch (error) {
        options.signal?.throwIfAborted();
        failures.push(error);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Some official replay patch observations failed; successful platforms were retained",
    );
  return summary;
}
