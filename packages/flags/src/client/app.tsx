import { useState } from "react";
import {
  Field,
  HeaderBar,
  ShellFrame,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { useDeployments, useDocument } from "./api.ts";
import { Editor } from "./editor.tsx";
import { FlagTable } from "./flag-table.tsx";
import { filterFlags, parseRoute, parseSearch, searchSuffix } from "./model.ts";
import { DeploymentPicker, DeploymentSidebar } from "./sidebar.tsx";

export function App({ theme }: { theme: ThemeStore }) {
  const route = parseRoute(globalThis.location.pathname);
  const deployments = useDeployments();
  const ids = deployments.data?.map((deployment) => deployment.id);
  const counts = new Map(
    (deployments.data ?? []).map(
      (deployment) => [deployment.id, deployment.flagCount] as const,
    ),
  );

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
        {route === undefined ? (
          <>
            <HeaderBar title="Flags" />
            <p className="fl-empty">Choose a deployment.</p>
          </>
        ) : (
          <Deployment
            catalog={route.catalog}
            stage={route.stage}
            flagKey={route.key}
          />
        )}
      </main>
    </ShellFrame>
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
  const [query, setQuery] = useState(() =>
    parseSearch(globalThis.location.search),
  );
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
  const flags = document.data.flags;
  const shown = filterFlags(flags, query);

  function search(next: string) {
    setQuery(next);
    globalThis.history.replaceState(
      null,
      "",
      `${globalThis.location.pathname}${searchSuffix(next)}`,
    );
  }

  return (
    <>
      <HeaderBar
        title={title}
        meta={`Revision ${String(document.data.revision)}`}
      />
      <div className="fl-body">
        <section className="fl-list" aria-label={`${title} flags`}>
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
              catalog={catalog}
              stage={stage}
              flags={shown}
              selectedKey={flagKey}
              query={query}
            />
          )}
        </section>
        {flagKey === undefined ? (
          <p className="fl-detail fl-empty">Select a flag.</p>
        ) : (
          <Editor
            key={flagKey}
            catalog={catalog}
            stage={stage}
            flagKey={flagKey}
            document={document.data}
            backHref={`/${encodeURIComponent(catalog)}/${encodeURIComponent(stage)}${searchSuffix(query)}`}
          />
        )}
      </div>
    </>
  );
}
