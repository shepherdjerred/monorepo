import { useEffect, useRef, useState } from "react";
import {
  SearchResponseSchema,
  type SearchKind,
  type SearchResponse,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  apiRequest,
  apiUrl,
  type ApiFailure,
  type ApiResult,
} from "@shepherdjerred/streambot/web/client/api.ts";
import {
  rowItem,
  type MediaItem,
} from "@shepherdjerred/streambot/web/client/media/row-model.ts";

type Capabilities = WebRoom["capabilities"];

export type GroupKey =
  "library" | "songs" | "albums" | "videos" | "live" | "history";

type GroupSpec = {
  readonly key: GroupKey;
  readonly title: string;
  readonly kinds: readonly SearchKind[];
  readonly enabled: (capabilities: Capabilities) => boolean;
};

/** Result groups in display order; each loads on its own. */
export const GROUPS: readonly GroupSpec[] = [
  {
    key: "library",
    title: "Your library",
    kinds: ["library"],
    enabled: () => true,
  },
  {
    key: "songs",
    title: "Songs",
    kinds: ["songs"],
    enabled: (capabilities) => capabilities.musicCatalog,
  },
  {
    key: "albums",
    title: "Albums & artists",
    kinds: ["albums", "artists"],
    enabled: (capabilities) => capabilities.musicCatalog,
  },
  { key: "videos", title: "Videos", kinds: ["videos"], enabled: () => true },
  {
    key: "live",
    title: "Live games",
    kinds: ["live"],
    enabled: (capabilities) => capabilities.sports,
  },
  {
    key: "history",
    title: "From your history",
    kinds: ["history"],
    enabled: (capabilities) => capabilities.history,
  },
];

export type GroupState =
  | { readonly status: "loading"; readonly items: readonly MediaItem[] }
  | {
      readonly status: "done";
      readonly items: readonly MediaItem[];
      readonly correctedQuery?: string;
    }
  | { readonly status: "failed"; readonly failure: ApiFailure };

/** A pasted http(s) link is one row in its own group; nothing else is searched for it. */
export function isLinkQuery(query: string): boolean {
  return /^https?:\/\/\S+$/iu.test(query.trim());
}

/** The groups a query searches, given what this viewer may use. */
export function searchedGroups(
  query: string,
  capabilities: Capabilities,
): readonly GroupSpec[] {
  if (isLinkQuery(query))
    return GROUPS.filter((group) => group.key === "videos").map((group) => ({
      ...group,
      title: "Link",
    }));
  return GROUPS.filter((group) => group.enabled(capabilities));
}

const DEBOUNCE_MS = 250;

/**
 * Searches every enabled group for `query` once typing pauses. Each group is its own request and
 * renders as soon as it answers; a newer query aborts every request of the older one. A group that
 * is loading again keeps its previous rows so the list does not flash.
 */
export function useSearch(
  query: string,
  guildId: string,
  capabilities: Capabilities | null,
) {
  const [groups, setGroups] = useState<Partial<Record<GroupKey, GroupState>>>(
    {},
  );
  const [settled, setSettled] = useState("");
  const load = useRef<((group: GroupSpec) => void) | null>(null);
  const latestCapabilities = useRef(capabilities);
  latestCapabilities.current = capabilities;
  const trimmed = query.trim();
  const flags =
    capabilities === null
      ? ""
      : [
          capabilities.musicCatalog,
          capabilities.sports,
          capabilities.history,
        ].join(",");

  useEffect(() => {
    const allowed = latestCapabilities.current;
    if (trimmed === "" || guildId === "" || flags === "" || allowed === null)
      return;
    const controller = new AbortController();
    const fetchGroup = (group: GroupSpec) => {
      setGroups((previous) => {
        const before = previous[group.key];
        return {
          ...previous,
          [group.key]: {
            status: "loading",
            items: before?.status === "failed" ? [] : (before?.items ?? []),
          },
        };
      });
      const search = async () => {
        const results = await Promise.all(
          group.kinds.map((kind) =>
            apiRequest(
              apiUrl("/api/search/v2", { guildId, kind, q: trimmed }),
              SearchResponseSchema,
              { signal: controller.signal },
            ),
          ),
        );
        if (controller.signal.aborted) return;
        const next = groupState(results);
        setGroups((previous) => ({ ...previous, [group.key]: next }));
      };
      void search();
    };
    load.current = fetchGroup;
    const timer = setTimeout(() => {
      setSettled(trimmed);
      for (const group of searchedGroups(trimmed, allowed)) fetchGroup(group);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `flags` changes only when a capability this effect reads changes.
  }, [trimmed, guildId, flags]);

  return {
    /** The query the shown groups belong to. */
    settled,
    groups,
    specs: capabilities === null ? [] : searchedGroups(settled, capabilities),
    retry: (key: GroupKey) => {
      const group = GROUPS.find((candidate) => candidate.key === key);
      if (group !== undefined) load.current?.(group);
    },
  };
}

/**
 * One group's state from its requests (albums and artists are two): the first failure, or every
 * row in request order with the provider's typo correction when it made one.
 */
export function groupState(
  results: readonly ApiResult<SearchResponse>[],
): GroupState {
  const items: MediaItem[] = [];
  let correctedQuery: string | undefined;
  for (const result of results) {
    if (!result.ok) return { status: "failed", failure: result.failure };
    items.push(...result.data.items.map((row) => rowItem(row)));
    correctedQuery ??= result.data.correctedQuery;
  }
  return correctedQuery === undefined
    ? { status: "done", items }
    : { status: "done", items, correctedQuery };
}
