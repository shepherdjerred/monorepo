import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { delivery } from "#client/api.ts";
import { queries } from "#client/queries.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { TracePage } from "./trace-page.tsx";
import { VersionSearchSchema, formSearch } from "./search-schemas.ts";
import { Route as rootRoute } from "./root.tsx";

function Comparison({ from, to }: { from: string; to: string }) {
  const diff = useQuery({
    queryKey: ["diff", from, to],
    queryFn: () => delivery.diff(from, to),
  });
  if (diff.isPending) return <p role="status">Comparing…</p>;
  if (diff.error !== null) return <ErrorNotice error={diff.error} />;
  if (diff.data.length === 0) return <p>No artifact changes.</p>;
  return (
    <ul className="diff">
      {diff.data.map((change) => (
        <li key={change.component}>
          <strong>{change.component}</strong>{" "}
          <span className="mono">
            {change.before?.version ?? "Absent"}{" "}
            <span aria-hidden="true">→</span>
            <span className="visually-hidden"> to </span>{" "}
            {change.after?.version ?? "Removed"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VersionPage() {
  const { versionSetId } = Route.useParams();
  const { compare } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(queries.versionTrace(versionSetId));
  const versions = useQuery(queries.versions(data.service.id));
  const revision = data.versionSet?.revision ?? 0;
  return (
    <>
      <TracePage trace={data} title={`Version set r${String(revision)}`} />
      <section className="panel" aria-labelledby="compare-heading">
        <h2 id="compare-heading">Compare</h2>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate({
              search: VersionSearchSchema.parse(
                formSearch(event.currentTarget),
              ),
            });
          }}
        >
          <label>
            Against version set
            <select name="compare" defaultValue={compare ?? ""} required>
              <option value="">Choose a revision</option>
              {versions.data
                ?.filter((version) => version.id !== versionSetId)
                .map((version) => (
                  <option key={version.id} value={version.id}>
                    r{version.revision}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className="secondary-button">
            Compare
          </button>
          {compare !== undefined && (
            <Link to="/versions/$versionSetId" params={{ versionSetId }}>
              Clear
            </Link>
          )}
        </form>
        {compare !== undefined && (
          <Comparison from={compare} to={versionSetId} />
        )}
      </section>
    </>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/versions/$versionSetId",
  validateSearch: VersionSearchSchema,
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.versionTrace(params.versionSetId),
      staleTime: "static",
    }),
  component: VersionPage,
});
