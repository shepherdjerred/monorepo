import {
  HeaderBar,
  ShellFrame,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, Route, Routes } from "react-router";
import { fetchOverview, fetchProjects, queryKeys } from "./api.ts";
import { IssueDetailPage } from "./issue-detail-page.tsx";
import { IssuesPage } from "./issues-page.tsx";
import { OverviewPage } from "./overview-page.tsx";
import { CommandPalette } from "./palette.tsx";
import { ProjectsPage } from "./projects-page.tsx";
import { ReleasesPage } from "./releases-page.tsx";
import { ErrorsSidebar, Topbar } from "./shell-nav.tsx";
import { themeStore as defaultThemeStore } from "./theme.ts";

function NotFoundPage(): React.JSX.Element {
  return (
    <main>
      <title>Not found · Errors</title>
      <HeaderBar title="Page not found" />
      <p className="er-state">
        This page does not exist.{" "}
        <Link className="er-subtle-link" to="/">
          Return to Overview
        </Link>
        .
      </p>
    </main>
  );
}

export function App({
  store = defaultThemeStore,
}: {
  readonly store?: ThemeStore | undefined;
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);

  const overviewQuery = useQuery({
    queryKey: queryKeys.overview,
    queryFn: ({ signal }) => fetchOverview(signal),
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  const projects = projectsQuery.data ?? overviewQuery.data?.projects ?? [];
  const totalUnresolved = overviewQuery.data?.totalUnresolved;
  const totalRegressed = overviewQuery.data?.totalRegressed;

  return (
    <>
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <CommandPalette projects={projects} store={store} />
      <Topbar
        projects={projects}
        totalUnresolved={totalUnresolved}
        totalRegressed={totalRegressed}
        store={store}
      />
      <ShellFrame
        sidebar={
          <ErrorsSidebar
            projects={projects}
            totalUnresolved={totalUnresolved}
            totalRegressed={totalRegressed}
            store={store}
          />
        }
      >
        <div className="er-content" id="content" ref={contentRef} tabIndex={-1}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/issues/:id" element={<IssueDetailPage />} />
            <Route
              path="/issues/:id/events/:eventId"
              element={<IssueDetailPage />}
            />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:slug" element={<IssuesPage />} />
            <Route path="/releases" element={<ReleasesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </ShellFrame>
    </>
  );
}
