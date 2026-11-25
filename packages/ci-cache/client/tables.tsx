import {
  FigureStrip,
  Meter,
  StatusGlyph,
  Tabs,
} from "@shepherdjerred/console-ui";
import {
  formatBytes,
  formatCount,
  formatPercent,
  formatRelativeAge,
  formatTtlDays,
  hitRateSeverity,
  storageWatermarkSeverity,
} from "./fixture.ts";
import type {
  EntryViewTab,
  SummaryEntry,
  SummaryNamespace,
  SummaryResponse,
} from "./types.ts";

const ENTRY_TABS = [
  { value: "largest", label: "Largest entries" },
  { value: "recent", label: "Recent entries" },
] as const;

export function CacheHeadline({ summary }: { summary: SummaryResponse }) {
  const { window24h } = summary;
  const hitSeverity = hitRateSeverity(
    window24h.hits,
    window24h.misses,
    window24h.hitRate,
  );
  const watermarkSeverity = storageWatermarkSeverity(
    summary.totalStoredBytes,
    summary.lowWatermarkBytes,
    summary.highWatermarkBytes,
  );
  const watermarkLabel = `${formatBytes(summary.highWatermarkBytes)} watermark / ${formatBytes(summary.quotaBytes)} quota`;
  const quotaPercent =
    summary.quotaBytes === 0
      ? 0
      : Math.round((summary.totalStoredBytes / summary.quotaBytes) * 100);

  return (
    <>
      <FigureStrip
        figures={[
          {
            label: "Hit rate (24h)",
            value:
              window24h.hits + window24h.misses === 0
                ? "—"
                : formatPercent(window24h.hitRate),
            hint: `${formatCount(window24h.hits)} hits · ${formatCount(window24h.misses)} misses`,
            severity: hitSeverity,
          },
          {
            label: "Bytes served (24h)",
            value: formatBytes(window24h.bytesServed),
            hint: `+${formatBytes(window24h.bytesIngested)} ingested`,
          },
          {
            label: "Stored entries",
            value: formatCount(summary.totalEntries),
            hint: `${String(summary.namespaces.length)} namespaces · ${formatCount(window24h.evictions)} evicted (24h)`,
          },
          {
            label: "Storage used",
            value: formatBytes(summary.totalStoredBytes),
            hint: watermarkLabel,
            severity: watermarkSeverity,
          },
        ]}
      />
      <div className="ui-toolbar ci-cache-capacity-bar">
        <span className="ui-strong">PVC capacity</span>
        <Meter
          value={summary.totalStoredBytes}
          max={summary.highWatermarkBytes}
          severity={watermarkSeverity}
          label={`Stored bytes vs ${formatBytes(summary.highWatermarkBytes)} eviction watermark`}
          text={`${formatBytes(summary.totalStoredBytes)} / ${formatBytes(summary.highWatermarkBytes)}`}
        />
        <span className="ui-muted">
          Evicts at {formatBytes(summary.highWatermarkBytes)} down to{" "}
          {formatBytes(summary.lowWatermarkBytes)} ({String(quotaPercent)}% of{" "}
          {formatBytes(summary.quotaBytes)} quota)
        </span>
      </div>
    </>
  );
}

export function NamespacesTable({
  namespaces,
  highWatermarkBytes,
  generatedAt,
}: {
  namespaces: readonly SummaryNamespace[];
  highWatermarkBytes: number;
  generatedAt: number;
}) {
  return (
    <section aria-labelledby="namespaces-heading">
      <div className="ui-section-head">
        <h2 id="namespaces-heading" className="ui-section-title">
          Namespaces
        </h2>
        <span className="ui-count">{String(namespaces.length)}</span>
      </div>
      <div className="ui-table-scroll">
        <table className="ui-table ci-cache-table">
          <thead>
            <tr>
              <th scope="col">Namespace</th>
              <th scope="col">Protocol</th>
              <th scope="col" className="ui-num">
                Entries
              </th>
              <th scope="col" className="ui-num">
                Stored
              </th>
              <th scope="col">Share</th>
              <th scope="col" className="ui-num">
                TTL
              </th>
              <th scope="col">Hit rate (24h)</th>
              <th scope="col" className="ui-num">
                Served (24h)
              </th>
              <th scope="col" className="ui-num">
                Last hit
              </th>
            </tr>
          </thead>
          <tbody>
            {namespaces.length === 0 ? (
              <tr>
                <td colSpan={9} className="ci-cache-empty ui-muted">
                  No namespaces match the current filter.
                </td>
              </tr>
            ) : (
              namespaces.map((item) => {
                const totalOps = item.hits24h + item.misses24h;
                const sev = hitRateSeverity(
                  item.hits24h,
                  item.misses24h,
                  item.hitRate24h,
                );
                return (
                  <tr key={item.namespace}>
                    <th scope="row" className="ui-mono ui-lead">
                      {item.namespace}
                    </th>
                    <td className="ui-muted">{item.protocol}</td>
                    <td className="ui-num">{formatCount(item.entries)}</td>
                    <td className="ui-num">{formatBytes(item.storedBytes)}</td>
                    <td>
                      <Meter
                        value={item.storedBytes}
                        max={Math.max(highWatermarkBytes, 1)}
                        severity="info"
                        label={`${item.namespace} share of watermark`}
                      />
                    </td>
                    <td className="ui-num ui-muted">
                      {formatTtlDays(item.ttlSeconds)}
                    </td>
                    <td>
                      {totalOps === 0 ? (
                        <span className="ui-zero">No requests</span>
                      ) : (
                        <span className="ci-cache-rate">
                          <StatusGlyph severity={sev} hideLabel />
                          <span className="ui-num">
                            {formatPercent(item.hitRate24h)}
                          </span>
                          <span className="ui-muted">
                            ({formatCount(item.hits24h)}/{formatCount(totalOps)}
                            )
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="ui-num">
                      {formatBytes(item.bytesServed24h)}
                    </td>
                    <td className="ui-num ui-muted">
                      {formatRelativeAge(item.lastAccessedAt, generatedAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EntriesSection({
  tab,
  entries,
  generatedAt,
  onTabChange,
}: {
  tab: EntryViewTab;
  entries: readonly SummaryEntry[];
  generatedAt: number;
  onTabChange: (next: EntryViewTab) => void;
}) {
  return (
    <section aria-labelledby="entries-heading">
      <div className="ui-section-head ci-cache-entries-head">
        <div className="ci-cache-entries-title">
          <h2 id="entries-heading" className="ui-section-title">
            Indexed blobs
          </h2>
          <span className="ui-count">{String(entries.length)}</span>
        </div>
        <Tabs
          label="Entry sort order"
          options={ENTRY_TABS}
          value={tab}
          onChange={onTabChange}
        />
      </div>
      <div className="ui-table-scroll">
        <table className="ui-table ci-cache-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Namespace</th>
              <th scope="col" className="ui-num">
                Size
              </th>
              <th scope="col" className="ui-num">
                Hits
              </th>
              <th scope="col">Integrity</th>
              <th scope="col" className="ui-num">
                Last accessed
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="ci-cache-empty ui-muted">
                  No cached blobs match the current filter.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={`${entry.namespace}:${entry.key}`}>
                  <th scope="row" className="ui-mono ci-cache-key">
                    {entry.key}
                  </th>
                  <td className="ui-mono ui-muted">{entry.namespace}</td>
                  <td className="ui-num">{formatBytes(entry.sizeBytes)}</td>
                  <td className="ui-num">{formatCount(entry.hitCount)}</td>
                  <td>
                    <span className="ci-cache-integrity">
                      <span className="ui-mono ui-muted">
                        sha256:{entry.sha256Hex.slice(0, 12)}
                      </span>
                      {entry.hasSignatureTag && (
                        <span className="ui-chip" data-sev="ok">
                          Signed
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="ui-num ui-muted">
                    {formatRelativeAge(entry.lastAccessedAt, generatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
