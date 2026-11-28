import {
  Outlet,
  useLocation,
  useParams,
  useRoutes,
  useSearchParams,
  type RouteObject,
} from "react-router";
import {
  Card,
  CardToolbar,
  PageBody,
  SearchField,
  ShellFrame,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { useDeployments, useDocument } from "./api.ts";
import { DeploymentHeading } from "./deployment-heading.tsx";
import { Editor } from "./editor.tsx";
import { FlagTable } from "./flag-table.tsx";
import { useArchive, useFlagMetadata } from "./management-api.ts";
import {
  deploymentPath,
  filterFlags,
  pageTitle,
  searchSuffix,
  splitDeploymentId,
  withQuery,
  type Route,
} from "./model.ts";
import { viewOf, viewTitle } from "./nav.ts";
import { FlagsPalette } from "./palette.tsx";
import { DeploymentSidebar, FlagsTopBar } from "./sidebar.tsx";
import { ThemeContext } from "./theme-context.ts";
import { ArchivePage, archivedCount } from "./views/archive-page.tsx";
import { ComparePage } from "./views/compare-page.tsx";
import { itemCount, totalCounts } from "./views/drift-model.ts";
import { DriftPage } from "./views/drift-page.tsx";
import { descriptionsOf } from "./views/flag-meta.tsx";
import { HomePage } from "./views/home-page.tsx";
import { useDrift } from "./views/views-api.ts";

/** The deployment and flag the URL names; undefined on pages outside a deployment. */
function useDeploymentRoute(): Route | undefined {
  const { catalog, stage, key } = useParams();
  if (catalog === undefined || stage === undefined) return undefined;
  return key === undefined ? { catalog, stage } : { catalog, stage, key };
}

/** The navigation, the palette and the tab title around every page. */
function Shell({ theme }: { theme: ThemeStore }) {
  const route = useDeploymentRoute();
  const view = viewOf(useLocation().pathname);
  const deployments = useDeployments();
  const drift = useDrift();
  const archive = useArchive();
  const ids = deployments.data?.map((deployment) => deployment.id);
  const counts = new Map(
    (deployments.data ?? []).map(
      (deployment) => [deployment.id, deployment.flagCount] as const,
    ),
  );
  const title = view === undefined ? pageTitle(route) : viewTitle(view);
  const navigation = {
    ids,
    counts,
    route,
    view,
    driftCount:
      drift.data === undefined
        ? undefined
        : itemCount(totalCounts(drift.data.deployments)),
    archivedCount:
      archive.data === undefined ? undefined : archivedCount(archive.data),
    status: deployments.isPending ? "Loading deployments…" : undefined,
    failure: deployments.isError ? deployments.error.message : undefined,
    theme,
  };

  return (
    <>
      <title>{title}</title>
      <FlagsTopBar {...navigation} />
      <ShellFrame sidebar={<DeploymentSidebar {...navigation} />}>
        <Outlet />
      </ShellFrame>
      <FlagsPalette />
    </>
  );
}

function DeploymentPage() {
  const route = useDeploymentRoute();
  if (route === undefined)
    throw new Error("the deployment page needs :catalog and :stage");
  return (
    <Deployment
      catalog={route.catalog}
      stage={route.stage}
      flagKey={route.key}
    />
  );
}

function Deployment({
  catalog,
  stage,
  flagKey,
}: {
  catalog: string;
  stage: string;
  flagKey: string | undefined;
}) {
  const document = useDocument(catalog, stage);
  const descriptions = descriptionsOf(
    useFlagMetadata(catalog, stage).data?.flags,
  );
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const title = `${catalog} / ${stage}`;
  if (document.isPending) {
    return (
      <PageBody>
        <DeploymentHeading catalog={catalog} stage={stage} />
        <p className="ui-state" role="status">
          Loading flags…
        </p>
      </PageBody>
    );
  }
  if (document.isError) {
    return (
      <PageBody>
        <DeploymentHeading catalog={catalog} stage={stage} />
        <p className="ui-state" role="alert">
          {document.error.message}
        </p>
      </PageBody>
    );
  }
  // While the next deployment loads, the previous table stays on screen,
  // inert, and its links still point at the deployment it lists.
  const loading = document.isPlaceholderData;
  const listed = loading
    ? splitDeploymentId(document.data.id)
    : { catalog, stage };
  const flags = document.data.flags;
  const shown = filterFlags(flags, query, (flag) => descriptions.get(flag.key));

  function search(next: string) {
    setParams((current) => withQuery(current, next), { replace: true });
  }

  return (
    <PageBody>
      <DeploymentHeading
        catalog={catalog}
        stage={stage}
        meta={
          loading ? "Loading…" : `Revision ${String(document.data.revision)}`
        }
      />
      <div
        className="fl-body"
        data-flag={flagKey === undefined ? undefined : ""}
        aria-busy={loading ? true : undefined}
      >
        <div className="fl-list" inert={loading}>
          <Card label={`${title} flags`}>
            <CardToolbar>
              <SearchField
                label="Search"
                value={query}
                placeholder="Filter flags by key or description"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  search(event.target.value);
                }}
              />
              <span className="ui-count" aria-live="polite">
                {shown.length} of {flags.length}
              </span>
            </CardToolbar>
            {shown.length === 0 ? (
              <p className="ui-state">No flags match “{query.trim()}”.</p>
            ) : (
              <FlagTable
                catalog={listed.catalog}
                stage={listed.stage}
                flags={shown}
                descriptions={descriptions}
                selectedKey={loading ? undefined : flagKey}
                query={query}
              />
            )}
          </Card>
        </div>
        {flagKey === undefined ? (
          <p className="fl-detail fl-empty">Select a flag.</p>
        ) : loading ? (
          <p className="fl-detail fl-empty">Loading flag…</p>
        ) : (
          <Editor
            key={`${catalog}/${stage}/${flagKey}`}
            catalog={catalog}
            stage={stage}
            flagKey={flagKey}
            document={document.data}
            backTo={`${deploymentPath(catalog, stage)}${searchSuffix(query)}`}
          />
        )}
      </div>
    </PageBody>
  );
}

/**
 * The pages inside the shell. Static paths such as `/compare` outrank the
 * `:catalog/:stage` patterns.
 */
const PAGES: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: "compare", element: <ComparePage /> },
  { path: "drift", element: <DriftPage /> },
  { path: "archive", element: <ArchivePage /> },
  { path: ":catalog/:stage", element: <DeploymentPage /> },
  { path: ":catalog/:stage/:key", element: <DeploymentPage /> },
  { path: "*", element: <HomePage /> },
];

/** Client-side routes: links navigate without reloading the page. */
export function App({ theme }: { theme: ThemeStore }) {
  const page = useRoutes([
    { element: <Shell theme={theme} />, children: PAGES },
  ]);
  return <ThemeContext value={theme}>{page}</ThemeContext>;
}
