import { Fragment } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  GlobeIcon,
} from "lucide-react";
import {
  formatBytes,
  formatUtcTimestamp,
  shortDigest,
  shortFingerprint,
  type ChartKind,
  type ChartSummaryItem,
} from "./model.ts";

function KindGlyph({ kind }: { readonly kind: ChartKind }): React.JSX.Element {
  if (kind === "first-party") {
    return (
      <span className="ui-glyph" data-sev="ok">
        <CircleCheckIcon className="ui-glyph-icon" aria-hidden="true" />
        <span>First-party</span>
      </span>
    );
  }
  return (
    <span className="ui-glyph" data-sev="info">
      <GlobeIcon className="ui-glyph-icon" aria-hidden="true" />
      <span>Upstream mirror</span>
    </span>
  );
}

function DigestCell({
  digest,
  contentFingerprint,
}: {
  readonly digest: string;
  readonly contentFingerprint: string | null;
}): React.JSX.Element {
  const fpShort = shortFingerprint(contentFingerprint);
  return (
    <div className="ch-identity">
      <span className="ui-mono" title={`Archive SHA-256: ${digest}`}>
        {shortDigest(digest)}
      </span>
      {fpShort === null ? (
        <span className="ui-muted ch-sub">no fingerprint</span>
      ) : (
        <span
          className="ui-mono ui-muted ch-sub"
          title={`Content fingerprint: ${contentFingerprint ?? ""}`}
        >
          fp:{fpShort}
        </span>
      )}
    </div>
  );
}

export function ChartsTable({
  charts,
  expandedNames,
  onToggleExpand,
}: {
  readonly charts: readonly ChartSummaryItem[];
  readonly expandedNames: ReadonlySet<string>;
  readonly onToggleExpand: (name: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="ui-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Helm charts catalog"
    >
      <table className="ui-table ch-table">
        <thead>
          <tr>
            <th scope="col">Chart</th>
            <th scope="col">Latest version</th>
            <th scope="col">Kind</th>
            <th scope="col" className="ui-num">
              Releases
            </th>
            <th scope="col" className="ui-num">
              Total size
            </th>
            <th scope="col">Digest / Fingerprint</th>
            <th scope="col">Published</th>
            <th scope="col" className="ui-num">
              Archive
            </th>
          </tr>
        </thead>
        <tbody>
          {charts.map((chart) => {
            const expanded = expandedNames.has(chart.name);
            const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
            return (
              <Fragment key={chart.name}>
                <tr data-expanded={expanded ? "" : undefined}>
                  <th scope="row" className="ch-chart-cell">
                    <div className="ch-chart-head">
                      <button
                        type="button"
                        className="ui-twist"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${chart.name} versions`}
                        onClick={() => {
                          onToggleExpand(chart.name);
                        }}
                      >
                        <Chevron aria-hidden="true" />
                      </button>
                      <div className="ch-chart-meta">
                        <span className="ui-mono ui-strong">{chart.name}</span>
                        {chart.description === "" ? null : (
                          <span className="ui-muted ch-desc">
                            {chart.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                  <td className="ui-mono">
                    <span>{chart.latestVersion}</span>
                    {chart.latestAppVersion === "" ||
                    chart.latestAppVersion === chart.latestVersion ? null : (
                      <span className="ui-muted ch-sub">
                        app {chart.latestAppVersion}
                      </span>
                    )}
                  </td>
                  <td>
                    <KindGlyph kind={chart.kind} />
                  </td>
                  <td className="ui-num ui-mono">
                    {String(chart.releaseCount)}
                  </td>
                  <td className="ui-num ui-mono">
                    {formatBytes(chart.totalBytes)}
                  </td>
                  <td>
                    <DigestCell
                      digest={chart.latestDigest}
                      contentFingerprint={chart.latestContentFingerprint}
                    />
                  </td>
                  <td className="ui-mono ui-muted">
                    {formatUtcTimestamp(chart.latestCreated)}
                  </td>
                  <td className="ui-num">
                    <a
                      className="ui-btn ch-dl-btn"
                      href={`/${chart.latestUrl}`}
                      download
                    >
                      <DownloadIcon aria-hidden="true" />
                      .tgz
                    </a>
                  </td>
                </tr>
                {expanded
                  ? chart.releases.map((release, index) => {
                      const archiveUrl =
                        release.urls[0] ??
                        `charts/${release.name}-${release.version}.tgz`;
                      const metaUrl = `/api/charts/${encodeURIComponent(release.name)}/${encodeURIComponent(release.version)}`;
                      return (
                        <tr
                          key={`${chart.name}@${release.version}`}
                          className="ui-table-child"
                        >
                          <td className="ch-child-lead">
                            <span className="ui-muted">
                              {index === 0 ? "Latest release" : "Retained"}
                            </span>
                          </td>
                          <td className="ui-mono">
                            <a className="ch-meta-link" href={metaUrl}>
                              {release.version}
                            </a>
                          </td>
                          <td className="ui-muted ui-mono">
                            {release.appVersion === ""
                              ? `api ${release.apiVersion}`
                              : `app ${release.appVersion}`}
                          </td>
                          <td className="ui-num ui-muted">1</td>
                          <td className="ui-num ui-mono">
                            {formatBytes(release.sizeBytes)}
                          </td>
                          <td>
                            <DigestCell
                              digest={release.digest}
                              contentFingerprint={release.contentFingerprint}
                            />
                          </td>
                          <td className="ui-mono ui-muted">
                            {formatUtcTimestamp(release.created)}
                          </td>
                          <td className="ui-num">
                            <a
                              className="ui-btn ch-dl-btn"
                              href={`/${archiveUrl}`}
                              download
                            >
                              <DownloadIcon aria-hidden="true" />
                              .tgz
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
