import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, ScrollRestoration, useNavigate } from "react-router";
import { Plus, Search } from "lucide-react";
import { api, type BootstrapData } from "#client/data/api.ts";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { NewIssue } from "#client/issues/issue-form.tsx";
import { IssueDetail } from "#client/issues/issue-detail.tsx";
import { Palette } from "./palette.tsx";
import { Sidebar, BottomNavigation, MoreSheet } from "./navigation.tsx";
import { useIssueList, usePeek } from "#client/issues/issue-list-query.ts";
import { useIssue } from "#client/issues/issue-query.ts";
import { shortcutHelp, useShortcuts } from "./shortcuts.ts";
import { shellActions, type Overlay } from "./shell-actions.ts";
import { useRoute, type RouteInfo } from "./route.ts";
import { useTeamKey } from "./team.ts";
import { LiveRegion } from "./announce.tsx";
import type { ShellContext } from "./shell-context.ts";

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

/** The persistent layout: navigation, overlays and shortcuts outlive every route. */
export function Shell() {
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.meta.bootstrap.query(),
  });
  const navigate = useNavigate();
  const route = useRoute();
  const data = bootstrap.data;
  const teamKey = useTeamKey(data);
  const issues = useIssueList(route, teamKey);
  const peek = usePeek(route.isList);
  const pageIssue = useIssue(route.identifier);
  const [overlay, setOverlay] = useState<Overlay>();
  const [current, setCurrent] = useState<string>();
  const items = issues.data?.items ?? [];
  const actions = shellActions({
    route,
    items,
    peek,
    current,
    navigate,
    overlay,
    setOverlay,
  });
  const onKeyDown = useShortcuts(
    (key) => actions[key]?.() ?? false,
    overlay !== undefined,
  );
  const heading = pageHeading(route, data);
  const closeOverlay = () => {
    setOverlay(undefined);
  };
  const newIssue = () => {
    setOverlay("create");
  };
  const context: ShellContext | undefined =
    data === undefined || teamKey === undefined
      ? undefined
      : {
          bootstrap: data,
          teamKey,
          view: route.view,
          list: {
            items,
            loading: issues.isPending,
            busy: issues.isPlaceholderData,
            error: issues.error,
          },
          current,
          setCurrent,
          openPeek: peek.open,
          create: newIssue,
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
            <div className="loading">Loading workspace…</div>
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
            open={overlay === "create"}
            close={closeOverlay}
            bootstrap={context.bootstrap}
            teamKey={context.teamKey}
            onCreated={(value) => {
              void navigate(`/issues/${value}`);
            }}
          />
          <Modal
            title={peek.identifier ?? "Issue"}
            open={peek.identifier !== undefined}
            onClose={peek.close}
            className="peek"
          >
            {peek.identifier !== undefined && (
              <IssueDetail
                identifier={peek.identifier}
                bootstrap={context.bootstrap}
                peek
                close={peek.close}
              />
            )}
          </Modal>
        </>
      )}
      {overlay === "palette" && (
        <Palette
          currentIssue={peek.identifier ?? route.identifier}
          action={(key) => actions[key]?.()}
          close={closeOverlay}
          navigate={(to) => {
            void navigate(to);
          }}
          create={newIssue}
        />
      )}
      <Modal
        title="Keyboard shortcuts"
        open={overlay === "help"}
        onClose={closeOverlay}
      >
        <dl className="shortcut-list">
          {shortcutHelp.map(([keys, description]) => (
            <div key={keys}>
              <dt>{description}</dt>
              <dd>
                <kbd>{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </Modal>
      <MoreSheet
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
      <LiveRegion />
      <ScrollRestoration />
    </div>
  );
}
