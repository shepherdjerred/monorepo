import { Link, createRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { Attention, HubService } from "#shared/hub/hub-contract.ts";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha, TargetLink, ToolLinks } from "#client/components/links.tsx";
import { ActivityList } from "./activity-list.tsx";
import { Route as rootRoute } from "./root.tsx";

const ATTENTION: Record<Attention["kind"], string> = {
  approval: "Approval",
  failed: "Failed",
  recovery: "Recovery",
  build_failed: "Build",
};

function ServiceCard({ service }: { service: HubService }) {
  const build = service.latestBuild;
  return (
    <li className="service-card">
      <h3>
        <Link to="/services/$serviceId" params={{ serviceId: service.id }}>
          {service.title}
        </Link>
      </h3>
      <p className="service-build">
        {build === null ? (
          <span className="muted">No builds</span>
        ) : (
          <>
            <Status value={build.status} />
            <Link to="/builds/$" params={{ _splat: build.id }}>
              <ShortSha sha={build.sourceRevision} />
            </Link>
            <RelativeTime value={build.createdAt} />
          </>
        )}
      </p>
      {service.environments.length > 0 && (
        <ol className="environment-strip" aria-label="Environments">
          {service.environments.map((env) => (
            <li key={env.id}>
              <Link
                to="/environments/$"
                params={{ _splat: env.id }}
                className={`env-pill env-${env.status}`}
              >
                <Status value={env.status} />
                <span className="env-name">{env.name}</span>
                {env.acceptedRevision !== null && (
                  <span className="muted">r{env.acceptedRevision}</span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function HubPage() {
  const { data } = useSuspenseQuery(queries.hub());
  return (
    <>
      <PageHeader
        eyebrow="Homelab CI/CD"
        title="Overview"
        description="Every change from commit to runtime, with the systems behind each step."
        actions={<ToolLinks links={data.tools} />}
      />
      {data.attention.length > 0 && (
        <section
          className="panel attention"
          aria-labelledby="attention-heading"
        >
          <h2 id="attention-heading">Needs attention</h2>
          <ul>
            {data.attention.map((item) => (
              <li key={`${item.kind}:${item.target.id}`}>
                <span className={`badge badge-${item.kind}`}>
                  {ATTENTION[item.kind]}
                </span>
                <TargetLink target={item.target}>{item.title}</TargetLink>
                <span className="muted">{item.detail}</span>
                {item.at !== null && <RelativeTime value={item.at} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="services-heading">
        <div className="section-heading">
          <h2 id="services-heading">Services</h2>
          <span className="muted">
            Latest build · environments in promotion order
          </span>
        </div>
        {data.services.length === 0 ? (
          <p className="empty">No services publish through Delivery yet.</p>
        ) : (
          <ul className="service-grid">
            {data.services.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </ul>
        )}
      </section>
      <section className="panel" aria-labelledby="activity-heading">
        <div className="section-heading">
          <h2 id="activity-heading">Recent activity</h2>
          <Link to="/activity">All activity</Link>
        </div>
        <ActivityList entries={data.activity} />
      </section>
    </>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) =>
    context.queryClient.query({ ...queries.hub(), staleTime: "static" }),
  component: HubPage,
});
