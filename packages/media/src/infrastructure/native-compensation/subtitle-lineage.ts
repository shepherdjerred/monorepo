import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import { PublicationSubtitleLineageSchema } from "#shared/publication-proof/subtitle-lineage.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { terminalRebindingChain } from "#infrastructure/native-recovery/terminal-rebinding.ts";
import { terminalSubtitleChain } from "#infrastructure/native-recovery/terminal-subtitles.ts";
import { settledInstalledSubtitle } from "#infrastructure/native-quarantine/installed-subtitles.ts";
import { publicationPhysicalSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

const digest = (value: unknown) => snapshotHash(nativeJson(value));

/** Every original caption survives exactly or through its own receipt; extras prove their own installation. */
export async function compensationSubtitleLineage(
  tx: Prisma.TransactionClient,
  input: {
    baseline: PublicationAssetSnapshot;
    current: PublicationAssetSnapshot;
    libraryKind: "movies" | "tv";
  },
  budget?: PublicationAuthorityReadBudget,
) {
  const { baseline, current } = input;
  if (
    current.version === baseline.version &&
    current.ownershipEpoch !== baseline.ownershipEpoch
  )
    throw new Error("Compensation physical epoch changed without a binding");
  const chain =
    current.version === baseline.version
      ? []
      : await terminalRebindingChain(
          tx,
          {
            asset: current,
            originalVersion: baseline.version,
            originalEpoch: baseline.ownershipEpoch,
          },
          budget,
        );
  const { subtitles: _before, ...beforeVideo } =
    publicationPhysicalSnapshot(baseline);
  const { subtitles: _after, ...afterVideo } =
    publicationPhysicalSnapshot(current);
  if (
    digest({
      ...beforeVideo,
      version: current.version,
      ownershipEpoch: current.ownershipEpoch,
    }) !== digest(afterVideo)
  )
    throw new Error("Compensation physical video lineage changed");
  const videoBindings = [
    { version: baseline.version, epoch: baseline.ownershipEpoch },
    ...chain.map((item) => ({
      version: item.binding.assetVersion,
      epoch: item.binding.ownershipEpoch,
    })),
  ];
  const files = [];
  const journals = [];
  const installations = [];
  const replacements = [];
  const artifactIdentities = [];
  const history: unknown[] = [chain];
  const matched = new Set<string>();
  for (const original of baseline.subtitles) {
    const subtitle = NativeSubtitleSnapshotSchema.parse(original);
    const unchanged = {
      ...subtitle,
      version: subtitle.version + chain.length,
      videoVersion: current.version,
      ownershipEpoch: current.ownershipEpoch,
    };
    if (subtitle.storageKind === "embedded") {
      assertEmbedded(current, subtitle.id, unchanged);
      matched.add(subtitle.id);
      continue;
    }
    const replacement = await terminalSubtitleChain(
      tx,
      {
        subtitleId: subtitle.id,
        checksum: z.string().parse(subtitle.checksum),
        canonicalPath: z.string().parse(subtitle.path),
        libraryKind: input.libraryKind,
        asset: current,
        videoBindings,
        subtitleRenewals: chain.map((item) => ({
          bindings: item.binding.subtitles,
          snapshots: item.subtitleSnapshots,
        })),
      },
      budget,
    );
    const actual = current.subtitles.find(
      (item) => item.id === replacement.current.id,
    );
    if (
      actual === undefined ||
      matched.has(actual.id) ||
      digest(actual) !== digest(replacement.current) ||
      (replacement.history.length === 0 && digest(actual) !== digest(unchanged))
    )
      throw new Error("Compensation sidecar lineage changed");
    matched.add(actual.id);
    if (replacement.history.length > 0)
      replacements.push({ beforeId: subtitle.id, afterId: actual.id });
    files.push(...replacement.files);
    journals.push(...replacement.journals);
    artifactIdentities.push(...replacement.artifactIdentities);
    history.push(replacement.history);
  }
  for (const item of current.subtitles.filter(
    (subtitle) => !matched.has(subtitle.id),
  )) {
    const installed = await settledInstalledSubtitle(tx, {
      subtitle: NativeSubtitleSnapshotSchema.parse(item),
      chain,
      video: {
        path: current.path,
        checksum: current.checksum,
        mediaIds: current.coverage
          .filter((row) => row.current)
          .map((row) => row.mediaId),
        libraryKind: input.libraryKind,
      },
      videoBindings,
    });
    installations.push(installed.installation);
    history.push(installed.history);
  }
  const unchanged = baseline.subtitles.map((subtitle) => ({
    ...subtitle,
    version: subtitle.version + chain.length,
    videoVersion: current.version,
    ownershipEpoch: current.ownershipEpoch,
  }));
  const lineage =
    digest(unchanged) === digest(current.subtitles)
      ? undefined
      : PublicationSubtitleLineageSchema.parse({
          baselineHash: digest(baseline.subtitles),
          currentHash: digest(current.subtitles),
          historyHash: digest(history),
          replacements,
          artifactIdentities,
          files,
          journals,
          installations,
        });
  return { chain, lineage };
}

function assertEmbedded(
  current: PublicationAssetSnapshot,
  id: string,
  unchanged: PublicationAssetSnapshot["subtitles"][number],
) {
  if (
    digest(current.subtitles.find((item) => item.id === id)) !==
    digest(unchanged)
  )
    throw new Error("Compensation embedded subtitle lineage changed");
}
