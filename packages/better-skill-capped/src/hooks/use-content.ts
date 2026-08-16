import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Content, ContentItem } from "#src/model/content";
import type { Manifest } from "#src/parser/manifest";
import { parseManifest } from "#src/parser/parser";
import { MANIFEST_QUERY_KEY, fetchManifest } from "./use-manifest.ts";

const byRecency = <T extends { releaseDate: Date }>(items: T[]): T[] =>
  [...items].sort(
    (left, right) => right.releaseDate.getTime() - left.releaseDate.getTime(),
  );

// Module-level stable select: React Query memoizes the result per data
// identity, so the parser runs once per manifest change, not per render.
function selectContent(manifest: Manifest): Content {
  const content = parseManifest(manifest);
  return {
    videos: byRecency(content.videos),
    courses: byRecency(content.courses),
    commentaries: byRecency(content.commentaries),
    unmappedVideos: byRecency(content.unmappedVideos),
  };
}

export type UseContentResult = {
  content: Content | undefined;
  itemsByUuid: Map<string, ContentItem>;
  isLoading: boolean;
  error: Error | null;
  /** Changes whenever a new manifest payload lands; usable as a cache key. */
  dataUpdatedAt: number;
};

export function useContent(): UseContentResult {
  const query = useQuery({
    queryKey: MANIFEST_QUERY_KEY,
    queryFn: fetchManifest,
    select: selectContent,
  });

  const itemsByUuid = useMemo(() => {
    const map = new Map<string, ContentItem>();
    if (query.data !== undefined) {
      for (const item of [
        ...query.data.videos,
        ...query.data.unmappedVideos,
        ...query.data.courses,
        ...query.data.commentaries,
      ]) {
        map.set(item.uuid, item);
      }
    }
    return map;
  }, [query.data]);

  return {
    content: query.data,
    itemsByUuid,
    isLoading: query.isLoading,
    error: query.error,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
