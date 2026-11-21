import { useDeployments, useDocument } from "./api.ts";
import { Editor } from "./editor.tsx";
import {
  deploymentPath,
  flagPath,
  listState,
  parseRoute,
  sidebarEntries,
} from "./model.ts";

export function App() {
  const route = parseRoute(globalThis.location.pathname);
  const deployments = useDeployments();
  const entries =
    deployments.data === undefined
      ? []
      : sidebarEntries(deployments.data.map((deployment) => deployment.id));

  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="brand">Flags</p>
        <nav aria-label="Deployments">
          {deployments.isPending ? <p>Loading deployments…</p> : null}
          {deployments.isError ? (
            <p role="alert">{deployments.error.message}</p>
          ) : null}
          <ul className="deployment-list">
            {entries.map((entry) =>
              entry.kind === "single" ? (
                <li key={entry.id}>
                  <DeploymentLink
                    id={entry.id}
                    label={entry.label}
                    current={route}
                  />
                </li>
              ) : (
                <li key={entry.catalog}>
                  <span className="catalog" id={`catalog-${entry.catalog}`}>
                    {entry.catalog}
                  </span>
                  <ul>
                    {entry.stages.map((stage) => (
                      <li key={stage.id}>
                        <DeploymentLink
                          id={stage.id}
                          label={stage.label}
                          current={route}
                          labelledBy={`catalog-${entry.catalog}`}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ),
            )}
          </ul>
        </nav>
      </aside>
      <main
        className="workspace"
        data-flag={route?.key === undefined ? undefined : ""}
      >
        {route === undefined ? (
          <p>Choose a deployment.</p>
        ) : (
          <Deployment
            catalog={route.catalog}
            stage={route.stage}
            flagKey={route.key}
          />
        )}
      </main>
    </div>
  );
}

function DeploymentLink({
  id,
  label,
  current,
  labelledBy,
}: {
  id: string;
  label: string;
  current: { readonly catalog: string; readonly stage: string } | undefined;
  labelledBy?: string;
}) {
  const [catalog, stage] = id.split("/");
  const href =
    catalog === undefined || stage === undefined
      ? "/"
      : deploymentPath(catalog, stage);
  const active =
    current !== undefined && `${current.catalog}/${current.stage}` === id;
  const linkId = `deployment-${id.replaceAll("/", "-")}`;
  return (
    <a
      id={linkId}
      href={href}
      aria-current={active ? "page" : undefined}
      aria-labelledby={
        labelledBy === undefined ? undefined : `${labelledBy} ${linkId}`
      }
    >
      {label}
    </a>
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
  if (document.isPending) return <p>Loading flags…</p>;
  if (document.isError) return <p role="alert">{document.error.message}</p>;
  const flags = document.data.flags;
  return (
    <>
      <section className="flag-list" aria-labelledby="list-heading">
        <h1 id="list-heading">
          {catalog}/{stage}
        </h1>
        <p className="muted">Revision {document.data.revision}</p>
        <div
          className="table-wrapper"
          tabIndex={0}
          role="region"
          aria-labelledby="flag-table-caption"
        >
          <table>
            <caption id="flag-table-caption">
              {catalog}/{stage} flags
            </caption>
            <thead>
              <tr>
                <th>Flag</th>
                <th>State</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr
                  key={flag.key}
                  data-current={flag.key === flagKey ? "" : undefined}
                >
                  <th scope="row">
                    <a
                      href={flagPath(catalog, stage, flag.key)}
                      aria-current={flag.key === flagKey ? "page" : undefined}
                    >
                      {flag.key}
                    </a>
                  </th>
                  <td>{listState(flag)}</td>
                  <td>{flag.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {flagKey === undefined ? (
        <p className="flag-detail muted">Select a flag.</p>
      ) : (
        <Editor
          catalog={catalog}
          stage={stage}
          flagKey={flagKey}
          document={document.data}
        />
      )}
    </>
  );
}
