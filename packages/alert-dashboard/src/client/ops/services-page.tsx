import { allSignals } from "@shepherdjerred/ops-model/assemble.ts";
import { worstSeverity } from "@shepherdjerred/ops-model/severity.ts";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";
import { Link } from "react-router";

import {
  PageHeading,
  SeverityBadge,
  WithSnapshot,
  services,
} from "./ops-ui.tsx";

function ServiceGrid({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const signals = allSignals(snapshot);
  const kinds = ["product", "workload", "platform"] as const;
  return (
    <>
      <PageHeading eyebrow="Service catalog" title="Services" />
      {kinds.map((kind) => (
        <section key={kind} aria-labelledby={`kind-${kind}`}>
          <h2 className="block-heading" id={`kind-${kind}`}>
            {kind === "product"
              ? "Products"
              : kind === "workload"
                ? "Workloads"
                : "Platform"}
          </h2>
          <ul className="service-grid">
            {services.services
              .filter((service) => service.kind === kind)
              .map((service) => {
                const own = signals.filter(
                  (signal) => signal.service === service.id,
                );
                const severity = worstSeverity(
                  own.map((signal) => signal.severity),
                );
                return (
                  <li key={service.id}>
                    <Link
                      className="service-card"
                      to={`/services/${service.id}`}
                    >
                      <strong>{service.title}</strong>
                      <SeverityBadge severity={severity} />
                      <span className="service-sub">
                        {own.length === 0
                          ? "No signals"
                          : `${String(own.length)} signal${own.length === 1 ? "" : "s"}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </>
  );
}

export function ServicesPage(): React.JSX.Element {
  return (
    <WithSnapshot title="Services">
      {(snapshot) => <ServiceGrid snapshot={snapshot} />}
    </WithSnapshot>
  );
}
