import { useEffect } from "react";
import {
  Outlet,
  useParams,
  useRoutes,
  useSearchParams,
  type RouteObject,
} from "react-router";
import {
  Field,
  HeaderBar,
  ShellFrame,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { useDeployments, useDocument } from "./api.ts";
import { Editor } from "./editor.tsx";
import { FlagTable } from "./flag-table.tsx";
import {
  deploymentPath,
  filterFlags,
  pageTitle,
  searchSuffix,
  splitDeploymentId,
  withQuery,
  type Route,
} from "./model.ts";
import { DeploymentPicker, DeploymentSidebar } from "./sidebar.tsx";
import { ThemeContext } from "./theme-context.ts";

/** The deployment and flag the URL names; undefined on pages outside a deployment. */
function useDeploymentRoute(): Route | undefined {
  const { catalog, stage, key } = useParams();
  if (catalog === undefined || stage === undefined) return undefined;
  return key === undefined ? { catalog, stage } : { catalog, stage, key };
}

/** The sidebar, the narrow-width picker and the tab title around every page. */
function Shell({ theme }: { theme: ThemeStore }) {
  const route = useDeploymentRoute();
  const deployments = useDeployments();
  const ids = deployments.data?.map((deployment) => deployment.id);
  const counts = new Map(
    (deployments.data ?? []).map(
      (deployment) => [deployment.id, deployment.flagCount] as const,
    ),
  );
  const title = pageTitle(route);
  useEffect(() => {
    globalThis.document.title = title;
  }, [title]);

  return (
    <ShellFrame
      sidebar={
        <DeploymentSidebar
          ids={ids}
          counts={counts}
          route={route}
          theme={theme}
          status={deployments.isPending ? "Loading deployments…" : undefined}
          failure={deployments.isError ? deployments.error.message : undefined}
        />
      }
    >
      <main
        className="fl-workspace"
        data-flag={route?.key === undefined ? undefined : ""}
      >
        {ids === undefined ? null : (
          <DeploymentPicker ids={ids} route={route} />
        )}
        <Outlet />
      </main>
    </ShellFrame>
  );
}

function Home() {
  return (
    <>
      <HeaderBar title="Flags" />
      <p className="fl-empty">Choose a deployment.</p>
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
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const title = `${catalog} / ${stage}`;
  if (document.isPending) {
    return (
      <>
        <HeaderBar title={title} />
        <p className="fl-empty">Loading flags…</p>
      </>
    );
  }
  if (document.isError) {
    return (
      <>
        <HeaderBar title={title} />
        <p className="fl-empty" role="alert">
          {document.error.message}
        </p>
      </>
    );
  }
  // While the next deployment loads, the previous table stays on screen,
  // inert, and its links still point at the deployment it lists.
  const loading = document.isPlaceholderData;
  const listed = loading
    ? splitDeploymentId(document.data.id)
    : { catalog, stage };
  const flags = document.data.flags;
  const shown = filterFlags(flags, query);

  function search(next: string) {
    setParams((current) => withQuery(current, next), { replace: true });
  }

  return (
    <>
      <HeaderBar
        title={title}
        meta={
          loading ? "Loading…" : `Revision ${String(document.data.revision)}`
        }
      />
      <div className="fl-body" aria-busy={loading ? true : undefined}>
        <section
          className="fl-list"
          aria-label={`${title} flags`}
          inert={loading}
        >
          <div className="ui-toolbar">
            <Field label="Search" layout="inline">
              {(control) => (
                <input
                  {...control}
                  type="search"
                  value={query}
                  placeholder="Filter flags by key"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    search(event.target.value);
                  }}
                />
              )}
            </Field>
            <span className="ui-count" aria-live="polite">
              {shown.length} of {flags.length}
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="fl-empty">No flags match “{query.trim()}”.</p>
          ) : (
            <FlagTable
              catalog={listed.catalog}
              stage={listed.stage}
              flags={shown}
              selectedKey={loading ? undefined : flagKey}
              query={query}
            />
          )}
        </section>
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
    </>
  );
}

/**
 * The pages inside the shell. A new page such as `/compare` or `/drift` is
 * one more entry here; static paths outrank the `:catalog/:stage` patterns.
 */
const PAGES: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: ":catalog/:stage", element: <DeploymentPage /> },
  { path: ":catalog/:stage/:key", element: <DeploymentPage /> },
  { path: "*", element: <Home /> },
];

/** Client-side routes: links and the picker navigate without reloading the page. */
export function App({ theme }: { theme: ThemeStore }) {
  const page = useRoutes([
    { element: <Shell theme={theme} />, children: PAGES },
  ]);
  return <ThemeContext value={theme}>{page}</ThemeContext>;
}
