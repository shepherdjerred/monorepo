import { Button, HeaderBar } from "@shepherdjerred/console-ui";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  IssueFilterTabSchema,
  type IssueFilterTab,
  type IssueState,
} from "#shared/contract.ts";
import {
  bulkUpdateIssues,
  fetchIssues,
  fetchProject,
  fetchProjects,
  queryKeys,
  type IssueListParams,
} from "./api.ts";
import { IssuesInboxView, parseSortParam } from "./issues-table.tsx";

function parseTabParam(raw: string | null): IssueFilterTab {
  const parsed = IssueFilterTabSchema.safeParse(raw);
  return parsed.success ? parsed.data : "unresolved";
}

export function IssuesPage(): React.JSX.Element {
  const routeParams = useParams();
  const lockedSlug = routeParams["slug"];
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const tab = parseTabParam(searchParams.get("tab"));
  const sort = parseSortParam(searchParams.get("sort"));
  const query = searchParams.get("q") ?? "";
  const release = searchParams.get("release") ?? "";
  const projectFilter = lockedSlug ?? searchParams.get("project") ?? "";

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [copiedDsn, setCopiedDsn] = useState(false);
  const copyTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(undefined);

  const updateParam = (key: string, value: string, defaultValue = ""): void => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultValue || value.length === 0) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSelectedIds(new Set());
    setSearchParams(next, { replace: key === "q" });
  };

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  const projectQuery = useQuery({
    queryKey: queryKeys.project(lockedSlug ?? ""),
    queryFn: ({ signal }) => fetchProject(lockedSlug ?? "", signal),
    enabled: lockedSlug !== undefined && lockedSlug.length > 0,
  });

  const listParams: IssueListParams = useMemo(
    () => ({
      ...(projectFilter.length > 0 ? { project: projectFilter } : {}),
      tab,
      ...(query.trim().length > 0 ? { q: query.trim() } : {}),
      ...(release.trim().length > 0 ? { release: release.trim() } : {}),
      sort,
      order: "desc",
      limit: 50,
    }),
    [projectFilter, query, release, sort, tab],
  );

  const issuesQuery = useInfiniteQuery({
    queryKey: queryKeys.issues(listParams),
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      fetchIssues(
        {
          ...listParams,
          ...(pageParam.length > 0 ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const bulkMutation = useMutation({
    mutationFn: (state: IssueState) =>
      bulkUpdateIssues({ ids: [...selectedIds], state }),
    onSuccess: async () => {
      setSelectedIds(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issuesRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        ...(lockedSlug === undefined
          ? []
          : [
              queryClient.invalidateQueries({
                queryKey: queryKeys.project(lockedSlug),
              }),
            ]),
      ]);
    },
  });

  const items = useMemo(
    () =>
      issuesQuery.data === undefined
        ? []
        : issuesQuery.data.pages.flatMap((page) => page.items),
    [issuesQuery.data],
  );
  const visibleIdSet = useMemo(
    () => new Set(items.map((item) => item.id)),
    [items],
  );
  const activeSelectedIds = useMemo(() => {
    const filtered = new Set<string>();
    for (const id of selectedIds) {
      if (visibleIdSet.has(id)) {
        filtered.add(id);
      }
    }
    return filtered;
  }, [selectedIds, visibleIdSet]);

  const projectSummary =
    projectQuery.data ??
    (lockedSlug === undefined
      ? undefined
      : projectsQuery.data?.find((item) => item.slug === lockedSlug));

  const title =
    lockedSlug === undefined ? "Issues" : (projectSummary?.name ?? lockedSlug);

  if (issuesQuery.isError) {
    return (
      <main>
        <title>{`${title} · Errors`}</title>
        <HeaderBar title={title} />
        <div className="er-banner" data-sev="error" role="alert">
          <span>{issuesQuery.error.message}</span>
          <Button
            onClick={() => {
              void issuesQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </main>
    );
  }

  if (issuesQuery.isPending) {
    return (
      <main>
        <title>{`${title} · Errors`}</title>
        <HeaderBar title={title} />
        <p className="er-state" role="status">
          Loading issues…
        </p>
      </main>
    );
  }

  const handleCopyDsn = (): void => {
    if (projectSummary === undefined) {
      return;
    }
    void (async () => {
      try {
        await globalThis.navigator.clipboard.writeText(projectSummary.dsn);
        setCopiedDsn(true);
        if (copyTimerRef.current !== undefined) {
          globalThis.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = globalThis.setTimeout(() => {
          setCopiedDsn(false);
        }, 1800);
      } catch {
        // Ignore clipboard unavailability cleanly.
      }
    })();
  };

  return (
    <IssuesInboxView
      title={title}
      tab={tab}
      query={query}
      sort={sort}
      projectFilter={projectFilter}
      lockedProjectSlug={lockedSlug}
      projectSummary={projectSummary}
      projects={projectsQuery.data ?? []}
      items={items}
      selectedIds={activeSelectedIds}
      hasNextPage={issuesQuery.hasNextPage}
      isFetchingNextPage={issuesQuery.isFetchingNextPage}
      isRefreshing={issuesQuery.isFetching}
      isMutating={bulkMutation.isPending}
      copiedDsn={copiedDsn}
      mutationError={bulkMutation.isError ? bulkMutation.error.message : null}
      onTabChange={(nextTab) => {
        updateParam("tab", nextTab, "unresolved");
      }}
      onQueryChange={(nextQuery) => {
        updateParam("q", nextQuery);
      }}
      onProjectFilterChange={(nextProject) => {
        updateParam("project", nextProject);
      }}
      onSortChange={(nextSort) => {
        updateParam("sort", nextSort, "last_seen");
      }}
      onToggleAll={(checked) => {
        setSelectedIds(
          checked ? new Set(items.map((item) => item.id)) : new Set(),
        );
      }}
      onToggleOne={(id, checked) => {
        const next = new Set(activeSelectedIds);
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        setSelectedIds(next);
      }}
      onBulkState={(state) => {
        bulkMutation.mutate(state);
      }}
      onClearSelection={() => {
        setSelectedIds(new Set());
      }}
      onLoadMore={() => {
        void issuesQuery.fetchNextPage();
      }}
      onRefresh={() => {
        void Promise.all([
          issuesQuery.refetch(),
          projectsQuery.refetch(),
          ...(lockedSlug === undefined ? [] : [projectQuery.refetch()]),
        ]);
      }}
      onCopyDsn={handleCopyDsn}
    />
  );
}
