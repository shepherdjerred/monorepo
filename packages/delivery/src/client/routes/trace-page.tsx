import { Link } from "@tanstack/react-router";
import type { ExecutionTrace } from "#shared/hub/hub-contract.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { ShortSha, ToolLinks } from "#client/components/links.tsx";
import { CiRunPanel, SourcePanel } from "#client/components/integrations.tsx";
import { PipelineGraph } from "#client/components/pipeline/pipeline-graph.tsx";
import { traceStages } from "#client/components/pipeline/trace-view-model.ts";
import { artifactToolLinks } from "#shared/hub/artifact-links.ts";

function Artifacts({ trace }: { trace: ExecutionTrace }) {
  return (
    <section className="panel" aria-labelledby="artifacts-heading">
      <h2 id="artifacts-heading">Artifacts</h2>
      {trace.artifacts.length === 0 ? (
        <p className="empty">This change published no artifacts.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Version</th>
                <th scope="col">Digest</th>
                <th scope="col">Registry</th>
              </tr>
            </thead>
            <tbody>
              {trace.artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <th scope="row">
                    {artifact.component}
                    <small>{artifact.kind}</small>
                  </th>
                  <td className="mono">{artifact.version}</td>
                  <td className="mono digest">
                    <abbr title={artifact.digest}>
                      {artifact.digest.slice(0, 19)}…
                    </abbr>
                  </td>
                  <td>
                    <ToolLinks links={artifactToolLinks(artifact)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TracePage({
  trace,
  title,
}: {
  trace: ExecutionTrace;
  title: string;
}) {
  const build = trace.build;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            to="/services/$serviceId"
            params={{ serviceId: trace.service.id }}
          >
            {trace.service.title}
          </Link>
        }
        title={title}
        description={
          <>
            <Status value={trace.status} />{" "}
            {build === null ? (
              "Composed by hand from existing artifacts."
            ) : (
              <>
                Commit <ShortSha sha={build.sourceRevision} />
                {build.qualificationReason !== null &&
                  ` · ${build.qualificationReason}`}
              </>
            )}
          </>
        }
        actions={build === null ? undefined : <ToolLinks links={build.links} />}
      />
      <PipelineGraph label="Path of this change" stages={traceStages(trace)} />
      <div className="detail-grid">
        {build !== null && build.sourceKind === "ci" && (
          <SourcePanel buildId={build.id} sha={build.sourceRevision} />
        )}
        {build?.pipelineNumber !== null && build !== null && (
          <CiRunPanel buildId={build.id} />
        )}
      </div>
      <Artifacts trace={trace} />
      {trace.versionSet !== null && (
        <p>
          <Link
            to="/versions/$versionSetId"
            params={{ versionSetId: trace.versionSet.id }}
          >
            Version set r{trace.versionSet.revision}
          </Link>{" "}
          selects these artifacts for deployment.
        </p>
      )}
    </>
  );
}
