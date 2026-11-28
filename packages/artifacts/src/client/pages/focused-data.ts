import { useMemo } from "react";
import type { VersionSummary } from "@shepherdjerred/artifacts/procedures";
import {
  useArtifact,
  useArtifactThreads,
  useVersion,
  useVersions,
} from "#client/data/queries.ts";

/**
 * Everything the focused view reads: the artifact, its versions newest first,
 * the version the `?v=` parameter selects (the current one by default), that
 * version's files, and the artifact's threads oldest first.
 */
export function useFocusedData(artifactId: string, requestedVersion: number) {
  const artifact = useArtifact(artifactId);
  const versions = useVersions(artifactId);
  const threads = useArtifactThreads(artifactId);

  const sorted = useMemo(
    () => [...(versions.data ?? [])].sort((a, b) => b.number - a.number),
    [versions.data],
  );
  const currentId = artifact.data?.currentVersion?.id;
  const shown: VersionSummary | undefined =
    sorted.find((candidate) => candidate.number === requestedVersion) ??
    sorted.find((candidate) => candidate.id === currentId) ??
    sorted[0];
  const isCurrent =
    shown !== undefined && shown.id === artifact.data?.current?.id;
  const other = useVersion(isCurrent ? undefined : shown?.id);
  const version = isCurrent ? artifact.data?.current : other.data;

  const all = useMemo(
    () =>
      [...(threads.data ?? [])].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
      ),
    [threads.data],
  );

  return { artifact, sorted, shown, version: version ?? undefined, all };
}
