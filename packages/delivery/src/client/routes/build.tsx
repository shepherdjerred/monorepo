import { createRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { TracePage } from "./trace-page.tsx";
import { Route as rootRoute } from "./root.tsx";

function BuildPage() {
  const { _splat: buildId = "" } = Route.useParams();
  const { data } = useSuspenseQuery(queries.buildTrace(buildId));
  const sha = data.build?.sourceRevision.slice(0, 7) ?? buildId;
  return <TracePage trace={data} title={`Change ${sha}`} />;
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/builds/$",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.buildTrace(params._splat ?? ""),
      staleTime: "static",
    }),
  component: BuildPage,
});
