import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import {
  Link,
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useParams,
} from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "#client/shell/app.tsx";
import { queryClient } from "#client/data/api.ts";
import { IssueView } from "#client/issues/issue-view.tsx";
import { IssueDetail } from "#client/issues/issue-detail.tsx";
import { Actors } from "#client/pages/actors.tsx";
import { GlobalActivity } from "#client/pages/activity-page.tsx";
import { Projects } from "#client/pages/projects.tsx";
import { Empty } from "#client/ui/ui.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { viewHandle } from "#client/shell/route.ts";
import "./styles.css";

const Settings = lazy(async () => {
  const module = await import("#client/pages/settings.tsx");
  return { default: module.Settings };
});

function Home() {
  return (
    <Navigate
      replace
      to={
        localStorage.getItem("tracker.view") === "board" ? "/board" : "/issues"
      }
    />
  );
}
function IssuePage() {
  const { bootstrap } = useShell();
  const identifier = useParams()["identifier"];
  if (identifier === undefined) {
    throw new Error("The issue route requires an identifier");
  }
  return <IssueDetail identifier={identifier} bootstrap={bootstrap} />;
}
function SettingsPage() {
  const { bootstrap, teamKey } = useShell();
  return (
    <Suspense fallback={<div className="loading">Loading settings…</div>}>
      <Settings bootstrap={bootstrap} teamKey={teamKey} />
    </Suspense>
  );
}
function NotFound() {
  return (
    <Empty title="Nothing lives at this address">
      <Link to="/issues">Back to issues</Link>
    </Empty>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Home />, handle: viewHandle("home") },
      { path: "issues", element: <IssueView />, handle: viewHandle("issues") },
      {
        path: "issues/:identifier",
        element: <IssuePage />,
        handle: viewHandle("issue"),
      },
      { path: "board", element: <IssueView />, handle: viewHandle("board") },
      {
        path: "projects",
        element: <Projects />,
        handle: viewHandle("projects"),
      },
      {
        path: "projects/:slug",
        element: <IssueView />,
        handle: viewHandle("project"),
      },
      { path: "actors", element: <Actors />, handle: viewHandle("actors") },
      { path: "actors/:key", element: <Actors />, handle: viewHandle("actor") },
      {
        path: "activity",
        element: <GlobalActivity />,
        handle: viewHandle("activity"),
      },
      {
        path: "settings",
        element: <SettingsPage />,
        handle: viewHandle("settings"),
      },
      { path: "*", element: <NotFound />, handle: viewHandle("not-found") },
    ],
  },
]);

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Missing application root");
}
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
