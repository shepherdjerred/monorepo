import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { UplotChart } from "#client/charts/uplot-chart.tsx";
import { providerLabel } from "#client/ops/ai-labels.ts";

import { brimQuery } from "./api.ts";
import {
  BrimPage,
  BrimQueryState,
  BrimSection,
  BrimTable,
  cocoaEpochSeconds,
  cocoaNow,
  dateLabel,
  money,
  ReadingStatus,
} from "./presentation.tsx";
import {
  BrimOverviewSchema,
  type BrimOverview,
  type BrimStatus,
} from "./schema.ts";

type Quota = BrimOverview["quotas"][number];
type Sample = BrimOverview["quotaHistory"][number];
type CollectorView = {
  readonly data: BrimOverview;
  readonly reporting: boolean;
};

function readingStatus(status: BrimStatus, reporting: boolean): BrimStatus {
  return status === "current" && !reporting ? "not_reporting" : status;
}

function QuotaResets({
  provider,
  current,
  snapshot,
}: {
  readonly provider: string;
  readonly current: boolean;
  readonly snapshot: NonNullable<Quota["snapshot"]>;
}) {
  const now = cocoaNow();
  const resets = snapshot.resets?.filter(({ exp }) => exp > now) ?? [];
  if (snapshot.resetErrorMessage != null)
    return <p>{snapshot.resetErrorMessage}</p>;
  if (!["claude-code", "codex", "grok"].includes(provider)) return null;
  if (snapshot.resets === undefined) return <p>Reset inventory unavailable</p>;
  return (
    <p>
      {resets.length === 0
        ? current
          ? "No banked resets"
          : "No unexpired resets in the last reading"
        : `Banked reset expirations · ${resets.map(({ exp }) => dateLabel(exp)).join(", ")}`}
    </p>
  );
}

function Quotas({ data, reporting }: CollectorView) {
  return (
    <BrimSection title="Subscription quotas">
      {data.quotas.length === 0 ? (
        <p className="brim-message">
          MacBook hasn’t reported any subscription quotas.
        </p>
      ) : (
        <div className="brim-quota-grid">
          {data.quotas.map(({ provider, status, snapshot }) => (
            <article className="brim-quota" key={provider}>
              <header>
                <h3>{providerLabel(provider)}</h3>
                <ReadingStatus status={readingStatus(status, reporting)} />
              </header>
              {snapshot == null ? null : (
                <>
                  <p className="brim-muted">
                    {[
                      snapshot.accountLabel,
                      snapshot.plan?.name,
                      snapshot.plan?.monthlyCostUSD == null
                        ? null
                        : `${money(snapshot.plan.monthlyCostUSD)}/mo`,
                    ]
                      .filter((item) => item != null)
                      .join(" · ")}
                  </p>
                  <dl className="brim-windows">
                    {snapshot.windows.map((window) => (
                      <div key={window.id} className="brim-window">
                        <dt>{window.label}</dt>
                        <dd>
                          {window.usedPercent == null
                            ? "Usage unknown"
                            : `${String(window.usedPercent)}% used`}
                          {window.usedPercent == null ? null : (
                            <meter
                              min={0}
                              max={100}
                              value={window.usedPercent}
                              aria-label={window.label}
                            />
                          )}
                          {window.resetAt == null ? null : (
                            <span className="brim-muted">
                              {window.resetAt > cocoaNow() ? "Resets" : "Reset"}{" "}
                              {dateLabel(window.resetAt)}
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="brim-reading-details">
                    <QuotaResets
                      provider={provider}
                      current={status === "current" && reporting}
                      snapshot={snapshot}
                    />
                    {snapshot.notes?.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                    <p>Last reading {dateLabel(snapshot.sourceTimestamp)}</p>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </BrimSection>
  );
}

function QuotaHistory({ samples }: { readonly samples: readonly Sample[] }) {
  const selectId = useId();
  const [provider, setProvider] = useState("");
  const series = new Map<
    string,
    { name: string; points: [number, number][]; latest: Sample }
  >();
  const providers = [
    ...new Set(samples.map((sample) => sample.provider)),
  ].toSorted();
  const active = providers.includes(provider) ? provider : providers.at(0);
  for (const sample of samples) {
    if (sample.provider !== active) continue;
    const current = series.get(sample.windowID) ?? {
      name: sample.label,
      points: [],
      latest: sample,
    };
    current.points.push([
      sample.recordedAt + cocoaEpochSeconds,
      sample.usedPercent,
    ]);
    if (sample.recordedAt > current.latest.recordedAt) current.latest = sample;
    series.set(sample.windowID, current);
  }
  const values = [...series].map(([id, entry]) => ({
    id,
    ...entry,
    points: entry.points.toSorted(([a], [b]) => a - b),
  }));
  return (
    <BrimSection
      title="Quota history"
      aside={
        active === undefined ? null : (
          <label className="brim-inline-field" htmlFor={selectId}>
            Provider
            <select
              id={selectId}
              value={active}
              onChange={(event) => {
                setProvider(event.currentTarget.value);
              }}
            >
              {providers.map((item) => (
                <option key={item} value={item}>
                  {providerLabel(item)}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      {active === undefined ? (
        <p className="brim-message">No quota samples yet.</p>
      ) : (
        <div className="brim-chart">
          <UplotChart
            series={values}
            unit="percent"
            label={`${providerLabel(active)} quota history, percent used`}
          />
          <details>
            <summary>Latest reading by window</summary>
            <BrimTable
              label="Latest quota samples"
              columns={["Window", "Percent used", "Recorded", "Reset"]}
            >
              {values.map(({ id, name, latest }) => (
                <tr key={id}>
                  <th scope="row">{name}</th>
                  <td>{latest.usedPercent}%</td>
                  <td>{dateLabel(latest.recordedAt)}</td>
                  <td>{dateLabel(latest.resetAt)}</td>
                </tr>
              ))}
            </BrimTable>
          </details>
        </div>
      )}
    </BrimSection>
  );
}

function Billing({ data, reporting }: CollectorView) {
  return (
    <BrimSection title="API billing">
      {data.billing.length === 0 ? (
        <p className="brim-message">No API billing readings yet.</p>
      ) : (
        <BrimTable
          label="API billing"
          columns={[
            "Provider",
            "Month to date",
            "Projected",
            "Credits",
            "Status",
          ]}
        >
          {data.billing.map(({ platform, status, snapshot }) => (
            <tr key={platform}>
              <th scope="row">
                {platform === "openai" ? "OpenAI" : providerLabel(platform)}
                {snapshot == null ||
                snapshot.workspaceNames.length === 0 ? null : (
                  <small>{snapshot.workspaceNames.join(", ")}</small>
                )}
              </th>
              <td className="ui-num">
                {snapshot == null ? "—" : money(snapshot.monthlySpend)}
              </td>
              <td className="ui-num">
                {snapshot == null ? "—" : money(snapshot.projectedSpend)}
              </td>
              <td>
                {snapshot?.creditsRemaining == null
                  ? "—"
                  : money(snapshot.creditsRemaining)}
                {snapshot?.creditGrants?.map((grant) => (
                  <small
                    key={`${grant.kind}-${String(grant.remainingUSD)}-${String(grant.expiresAt)}`}
                  >
                    {grant.kind === "unspecified"
                      ? "Credit"
                      : providerLabel(grant.kind)}{" "}
                    {money(grant.remainingUSD)}
                    {grant.expiresAt == null
                      ? ""
                      : ` · expires ${dateLabel(grant.expiresAt)}`}
                  </small>
                ))}
                {snapshot?.creditGrantsUnavailableReason == null ? null : (
                  <small>{snapshot.creditGrantsUnavailableReason}</small>
                )}
              </td>
              <td>
                <ReadingStatus status={readingStatus(status, reporting)} />
                {snapshot == null ? null : (
                  <small>{dateLabel(snapshot.sourceTimestamp)}</small>
                )}
              </td>
            </tr>
          ))}
        </BrimTable>
      )}
    </BrimSection>
  );
}

function Archive({ archive }: { readonly archive: BrimOverview["archive"] }) {
  return (
    <BrimSection
      title="Transcript archive"
      aside={
        <span className="brim-muted">
          {archive.lastSuccessfulSyncAt === null
            ? "Cluster sync pending"
            : `Last cluster sync ${dateLabel(archive.lastSuccessfulSyncAt)}`}
        </span>
      }
    >
      {archive.devices.length === 0 ? (
        <p className="brim-message">No devices have been indexed.</p>
      ) : (
        <BrimTable
          label="Archive freshness by device"
          columns={["Device", "Archived", "Indexed"]}
        >
          {archive.devices.map((device) => (
            <tr key={device.machineId}>
              <th scope="row">{device.displayName}</th>
              <td>{dateLabel(device.lastArchivedAt)}</td>
              <td>{dateLabel(device.lastIndexedAt)}</td>
            </tr>
          ))}
        </BrimTable>
      )}
    </BrimSection>
  );
}

export function BrimOverviewPage() {
  const query = useQuery(
    brimQuery("overview?includeQuotaHistory=false", BrimOverviewSchema, 30_000),
  );
  const history = useQuery(brimQuery("overview", BrimOverviewSchema, 300_000));
  const data = query.data;
  const report = data?.collector.collectedAt;
  const expires = data?.collector.expiresAt;
  const reporting = expires != null && expires > cocoaNow();
  return (
    <BrimPage title="Brim">
      {data === undefined ? (
        <BrimQueryState error={query.error} label="Brim overview" />
      ) : (
        <>
          <div className="brim-source">
            <strong>MacBook</strong>
            <ReadingStatus status={reporting ? "current" : "not_reporting"} />
            {report == null ? null : (
              <span>Last report {dateLabel(report)}</span>
            )}
          </div>
          {query.error === null ? null : (
            <BrimQueryState error={query.error} label="latest readings" />
          )}
          <Quotas data={data} reporting={reporting} />
          <Billing data={data} reporting={reporting} />
          {history.data === undefined ? (
            <BrimQueryState error={history.error} label="quota history" />
          ) : (
            <QuotaHistory samples={history.data.quotaHistory} />
          )}
          <Archive archive={data.archive} />
        </>
      )}
    </BrimPage>
  );
}
