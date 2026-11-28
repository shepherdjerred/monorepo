import { StatusGlyph } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { worstSeverity } from "@shepherdjerred/ops-model/severity.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, Navigate, useLocation, useParams } from "react-router";

import { OpsApiError, serviceQuery } from "./ops-api.ts";
import {
  ChangeTimeline,
  ExternalLink,
  PageHeading,
  RangePicker,
} from "./ops-ui.tsx";
import { renderEngineeringServiceView } from "./service-views/engineering-views.tsx";
import {
  renderPlatformServiceView,
  UniversalServiceTelemetry,
} from "./service-views/platform-views.tsx";
import {
  renderProductServiceView,
  ServiceConsoleLink,
} from "./service-views/product-views.tsx";
import { SignalList } from "./signal-list.tsx";
import { useRange } from "#client/charts/use-range.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import type { ServiceDetail } from "#shared/ops-schema";

const SERVICE_ALIASES: Readonly<Record<string, string>> = {
  woodpecker: "ci",
  turbo: "ci",
  cloudflare: "networking",
  tailscale: "networking",
  seaweedfs: "storage",
  zfs: "storage",
  prometheus: "observability",
  loki: "observability",
  tempo: "observability",
  grafana: "observability",
  pyroscope: "observability",
  alloy: "observability",
  argocd: "gitops",
  scout: "scout-for-lol",
  media: "streambot",
  postal: "outbound-mail",
  mail: "outbound-mail",
  bugsink: "errors",
};

function Facts({
  detail,
}: {
  readonly detail: ServiceDetail;
}): React.JSX.Element {
  const { service } = detail;
  const rows: [string, readonly string[]][] = [
    ["Namespaces", service.namespaces],
    ["Argo CD apps", service.argoApps],
    ["Bugsink projects", service.bugsinkProjects],
    ["Analytics sites", service.analyticsSites],
    ["Deploy variants", service.deploy.map((variant) => variant.name)],
  ];
  return (
    <section className="panel metadata" aria-labelledby="catalog-heading">
      <h2 id="catalog-heading">Catalog</h2>
      <dl>
        <div>
          <dt>Kind</dt>
          <dd>{service.kind}</dd>
        </div>
        <div>
          <dt>Package</dt>
          <dd className="mono">{service.package ?? "—"}</dd>
        </div>
        {rows.map(([label, values]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">
              {values.length === 0 ? "—" : values.join(", ")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ServiceBody({
  detail,
}: {
  readonly detail: ServiceDetail;
}): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  const severity = worstSeverity(
    detail.signals.map((signal) => signal.severity),
  );
  const serviceTelemetry = renderEngineeringServiceView(
    detail.service.id,
    range,
  ) ??
    renderProductServiceView(detail.service.id, range) ??
    renderPlatformServiceView(detail.service.id, range) ?? (
      <UniversalServiceTelemetry detail={detail} range={range} />
    );
  return (
    <>
      <PageHeading title={detail.service.title}>
        <div className="platform-heading-actions">
          <ServiceConsoleLink serviceId={detail.service.id} />
          <RangePicker value={range} onChange={setRange} />
          <StatusGlyph
            severity={
              detail.snapshotGeneratedAt === null ? "unknown" : severity
            }
          />
        </div>
      </PageHeading>
      <Link className="back-link" to="/services">
        <ArrowLeftIcon aria-hidden="true" /> Services
      </Link>
      <p className="lede">
        {detail.snapshotGeneratedAt === null
          ? "No snapshot has been ingested yet."
          : `Signals from the snapshot generated ${age(detail.snapshotGeneratedAt)}.`}
      </p>
      <section className="drill-links" aria-label="Drill down">
        {detail.links.map((link) => (
          <ExternalLink
            className={`button drill-${link.kind}`}
            key={link.url}
            link={link}
          />
        ))}
      </section>
      {serviceTelemetry}
      <div className="service-layout">
        <div className="stack">
          <section
            className="panel list-panel"
            aria-labelledby="signals-heading"
          >
            <header className="panel-heading">
              <h2 id="signals-heading">Signals</h2>
            </header>
            <SignalList
              signals={detail.signals}
              empty="No signals for this service."
              label="Signals"
              showService={false}
            />
          </section>
          <Facts detail={detail} />
        </div>
        <section className="panel list-panel" aria-labelledby="changes-heading">
          <header className="panel-heading">
            <h2 id="changes-heading">What changed</h2>
          </header>
          <ChangeTimeline changes={detail.changes} showService={false} />
        </section>
      </div>
    </>
  );
}

export function ServicePage(): React.JSX.Element {
  const { id = "" } = useParams();
  const { search, hash } = useLocation();
  const aliasTarget = SERVICE_ALIASES[id];
  const detail = Loaded.fromQuery(
    useQuery({ ...serviceQuery(id), enabled: aliasTarget === undefined }),
  );
  if (aliasTarget !== undefined) {
    return (
      <Navigate
        to={{ pathname: `/services/${aliasTarget}`, search, hash }}
        replace
      />
    );
  }
  return (
    <main>
      <title>{`${id} · Hub`}</title>
      <LoadingBlock
        values={{ detail }}
        fallback={<div className="loading-state">Loading service…</div>}
        renderError={(errors) => {
          const error = errors[0].error;
          return error instanceof OpsApiError &&
            error.code === "service_not_found" ? (
            <div className="empty-state">
              No service <code>{id}</code> in the catalog.{" "}
              <Link to="/services">All services</Link>
            </div>
          ) : (
            <div className="error-state">Service detail is unavailable.</div>
          );
        }}
      >
        {({ detail: value }, meta) => (
          <>
            <StaleNotice errors={meta.errors} />
            <ServiceBody detail={value} />
          </>
        )}
      </LoadingBlock>
    </main>
  );
}
