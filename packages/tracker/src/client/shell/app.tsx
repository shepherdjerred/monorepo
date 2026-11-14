import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  ScrollRestoration,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { Plus, Search } from "lucide-react";
import { api, type BootstrapData } from "#client/data/api.ts";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { NewIssue, type IssuePrefill } from "#client/issues/issue-form.tsx";
import { ControlsLayer } from "#client/controls/bulk-bar.tsx";
import { SearchPickerHost } from "#client/controls/search-picker.tsx";
import { selectionScope } from "#client/controls/selection.ts";
import { currentActor } from "#client/data/identity.ts";
import { viewPrefill } from "#client/views/filters.ts";
import { IssueDetail } from "#client/issues/issue-detail.tsx";
import { Palette } from "./palette.tsx";
import { Sidebar, BottomNavigation, MoreSheet } from "./navigation.tsx";
import { useIssueList, usePeek } from "#client/issues/issue-list-query.ts";
import { useIssue } from "#client/issues/issue-query.ts";
import { useShortcuts } from "./shortcuts.ts";
import { ShortcutSheet } from "./shortcut-sheet.tsx";
import {
  actionTargets,
  shellActions,
  type Overlay,
  type Shell as ShellState,
} from "./shell-actions.ts";
import { useRoute, type RouteInfo } from "./route.ts";
import { useTeamKey } from "./team.ts";
import { Toaster } from "#client/ui/toast.tsx";
import { useLiveUpdates } from "#client/live/connection.ts";
import { LiveAnnouncer, LiveIndicator } from "#client/live/presence.tsx";
import { ViewSkeleton } from "#client/issues/issue-view.tsx";
import {
  ActivitySkeleton,
  ActorsSkeleton,
  DetailSkeleton,
  SettingsSkeleton,
} from "#client/ui/skeleton.tsx";
import { feedback } from "#client/feedback/index.ts";
import { useViewTransitions } from "#client/feedback/motion.ts";
import type { ShellContext } from "./shell-context.ts";
import { DuePickerHost } from "#client/due/due-picker.tsx";
import { useCreateRequests } from "#client/hierarchy/hierarchy-actions.ts";
import { ParentDialog } from "#client/hierarchy/parent-field.tsx";
import { useVisibleViews } from "#client/saved-views/view-params.ts";

const headings = {
  home: "Tracker",
  issues: "Issues",
  board: "Board",
  projects: "Projects",
  actors: "Actors",
  activity: "Activity",
  settings: "Settings",
  "not-found": "Page not found",
} as const;

function pageHeading(route: RouteInfo, data: BootstrapData | undefined) {
  if (route.view === "issue") {
    return route.identifier ?? headings.issues;
  }
  if (route.view === "project") {
    return (
      data?.projects.find((project) => project.slug === route.projectSlug)
        ?.name ??
      route.projectSlug ??
      headings.projects
    );
  }
  return route.view === "actor"
    ? (route.actorKey ?? headings.actors)
    : headings[route.view];
}

/** The routed page's shape while the workspace it needs is loading. */
function WorkspaceSkeleton({ route }: { route: RouteInfo }) {
  switch (route.view) {
    case "issue": {
      return <DetailSkeleton identifier={route.identifier ?? ""} />;
    }
    case "activity": {
      return (
        <div className="reading-page">
          <ActivitySkeleton />
        </div>
      );
    }
    case "actors":
    case "actor":
    case "projects": {
      return (
        <div className="reading-page">
          <ActorsSkeleton />
        </div>
      );
    }
    case "settings": {
      return <SettingsSkeleton />;
    }
    case "home":
    case "issues":
    case "board":
    case "project":
    case "not-found": {
      return <ViewSkeleton board={route.view === "board"} />;
    }
  }
}

/**
 * The peek shown while its dialog is open and while it animates closed, so
 * it leaves with its content rather than as an empty frame.
 */
function useShownPeek(identifier: string | undefined) {
  const [shown, setShown] = useState(identifier);
  if (identifier !== undefined && identifier !== shown) {
    setShown(identifier);
  }
  return identifier ?? shown;
}

/** The persistent layout: navigation, overlays and shortcuts outlive every route. */
export function Shell() {
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.meta.bootstrap.query(),
  });
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const route = useRoute();
  const data = bootstrap.data;
  const teamKey = useTeamKey(data);
  const issues = useIssueList(route, teamKey);
  const peek = usePeek(route.isList);
  const pageIssue = useIssue(route.identifier);
  useLiveUpdates(data?.liveUpdatesEnabled === true);
  const [overlay, setOverlayState] = useState<Overlay>();
  // Each opening of the palette starts fresh; between openings it stays
  // mounted so it can animate closed.
  const [paletteSession, setPaletteSession] = useState(0);
  const setOverlay = (next: Overlay | undefined) => {
    if (next === "palette" && overlay !== "palette") {
      setPaletteSession((session) => session + 1);
      feedback("palette");
    }
    setOverlayState(next);
  };
  const shownPeek = useShownPeek(peek.identifier);
  const viewTransitions = useViewTransitions();
  const [current, setCurrent] = useState<string>();
  // Each New issue opens fresh, with the fields the caller filled in.
  const [draft, setDraft] = useState<{ id: number; prefill: IssuePrefill }>({
    id: 0,
    prefill: {},
  });
  const scope = route.isList
    ? selectionScope(location.pathname, location.search)
    : "";
  const prefill = viewPrefill(params, {
    teamKey: teamKey ?? "",
    projectSlug: route.projectSlug,
    me: currentActor().key,
  });
  const create = (next: IssuePrefill = {}) => {
    setDraft((known) => ({ id: known.id + 1, prefill: next }));
    setOverlay("create");
  };
  useCreateRequests(create);
  const views = useVisibleViews(data, teamKey);
  const shellState: ShellState = {
    route,
    list: issues,
    peek,
    current,
    navigate,
    overlay,
    setOverlay,
    selectionScope: scope,
    create,
    prefill,
    views,
    teamKey,
  };
  const actions = shellActions(shellState);
  const loaded = useMemo(
    () => issues.items.map(({ identifier }) => identifier),
    [issues.items],
  );
  const onKeyDown = useShortcuts(
    (key) => actions[key]?.() ?? false,
    overlay !== undefined,
  );
  const heading = pageHeading(route, data);
  const closeOverlay = () => {
    setOverlay(undefined);
  };
  const newIssue = () => {
    create();
  };
  const context: ShellContext | undefined =
    data === undefined || teamKey === undefined
      ? undefined
      : {
          bootstrap: data,
          teamKey,
          view: route.view,
          list: issues,
          current,
          setCurrent,
          openPeek: peek.open,
          create,
          selectionScope: scope,
        };
  return (
    <div className="app-shell" ref={onKeyDown}>
      <title>
        {`${pageIssue.data === undefined ? heading : `${heading} · ${pageIssue.data.title}`} — Tracker`}
      </title>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>("#main")?.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar
        bootstrap={data}
        teamKey={teamKey}
        create={newIssue}
        search={() => {
          setOverlay("palette");
        }}
        help={() => {
          setOverlay("help");
        }}
      />
      <div className="main-content">
        <header className="page-header">
          {route.view === "issue" ? (
            <p className="page-title">{heading}</p>
          ) : (
            <h1 className="page-title">{heading}</h1>
          )}
          <span className="spacer" />
          <LiveIndicator className="mobile-live" />
          <button
            className="mobile-search icon-button"
            aria-label="Search"
            onClick={() => {
              setOverlay("palette");
            }}
          >
            <Search size={18} />
          </button>
          <button
            className="primary"
            disabled={data?.writesEnabled !== true}
            onClick={newIssue}
          >
            <Plus size={15} />
            <span>New issue</span>
          </button>
        </header>
        <main id="main" tabIndex={-1}>
          {bootstrap.error !== null && <ErrorNotice error={bootstrap.error} />}
          {context === undefined ? (
            <WorkspaceSkeleton route={route} />
          ) : (
            <>
              {!context.bootstrap.writesEnabled && (
                <div className="banner">
                  Tracker is read-only while migration is in progress.
                </div>
              )}
              <Outlet context={context} />
            </>
          )}
        </main>
      </div>
      {context !== undefined && (
        <>
          <NewIssue
            key={draft.id}
            open={overlay === "create"}
            close={closeOverlay}
            bootstrap={context.bootstrap}
            teamKey={context.teamKey}
            prefill={draft.prefill}
            onCreated={(value, view) => {
              if (view) {
                // The new issue's page takes over the screen at once; the
                // dialog it came from does not linger over it.
                setDraft((known) => ({ id: known.id + 1, prefill: {} }));
                void navigate(`/issues/${value}`);
              }
            }}
          />
          <ParentDialog />
          <Modal
            title={shownPeek ?? "Issue"}
            open={peek.identifier !== undefined}
            onClose={peek.close}
            className="peek"
            pickerScope="peek"
          >
            <SearchPickerHost bootstrap={context.bootstrap} scope="peek" />
            <DuePickerHost scope="peek" />
            {shownPeek !== undefined && (
              <IssueDetail
                identifier={shownPeek}
                bootstrap={context.bootstrap}
                peek
                close={peek.close}
              />
            )}
          </Modal>
        </>
      )}
      {paletteSession > 0 && context !== undefined && (
        <Palette
          key={paletteSession}
          open={overlay === "palette"}
          bootstrap={context.bootstrap}
          targets={actionTargets(shellState)}
          prefill={prefill}
          views={views}
          teamKey={context.teamKey}
          action={(key) => actions[key]?.()}
          close={closeOverlay}
          navigate={(to) => {
            // Opening an issue page from the palette morphs into it.
            void navigate(to, {
              viewTransition: viewTransitions && to.startsWith("/issues/"),
            });
          }}
          create={create}
        />
      )}
      <Modal
        title="Keyboard shortcuts"
        open={overlay === "help"}
        onClose={closeOverlay}
      >
        <ShortcutSheet />
      </Modal>
      <MoreSheet
        bootstrap={data}
        teamKey={teamKey}
        open={overlay === "more"}
        close={closeOverlay}
        help={() => {
          setOverlay("help");
        }}
      />
      <BottomNavigation
        more={() => {
          setOverlay("more");
        }}
        moreOpen={overlay === "more"}
      />
      {context !== undefined && (
        <ControlsLayer
          bootstrap={context.bootstrap}
          teamKey={context.teamKey}
          scope={scope}
          loaded={loaded}
        />
      )}
      <Toaster />
      <LiveAnnouncer />
      <ScrollRestoration />
    </div>
  );
}
