import { useMemo } from "react";
import { Loaded } from "@shepherdjerred/loaded";
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
    ...content,
    videos: byRecency(content.videos),
    courses: byRecency(content.courses),
    commentaries: byRecency(content.commentaries),
    unmappedVideos: byRecency(content.unmappedVideos),
  };
}

export type UseContentResult = {
  /**
   * The manifest as a renderability state rather than a
   * `content` / `isLoading` / `error` triple.
   *
   * The triple let all three be meaningful at once, and both call sites that
   * read `error` threw it unconditionally — so a background refetch that
   * failed while a parsed catalog was still cached blanked the page to the
   * route error boundary. `Loaded` reports that case as `degraded`: data
   * present, refresh failed, still renderable.
   */
  content: Loaded<Content>;
  itemsByUuid: Map<string, ContentItem>;
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
    content: Loaded.fromQuery(query, ["manifest"]),
    itemsByUuid,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
