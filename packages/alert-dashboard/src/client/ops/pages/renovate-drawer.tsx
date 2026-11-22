import type {
  RenovateFacet,
  RenovateItem,
} from "@shepherdjerred/ops-model/facets.ts";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { DataTable } from "#client/visuals/index.ts";

import {
  buildUpdateColumns,
  DEPRECATION_COLUMNS,
  ExtLink,
  IMPACT_OPTIONS,
  MERGED_COLUMNS,
  TYPE_OPTIONS,
  ver,
  versions,
} from "./renovate-helpers.tsx";

function CopyCommandButton(p: {
  readonly command: string;
  readonly packageName: string;
}): React.JSX.Element {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null,
  );
  const Icon = status === "copied" ? CheckIcon : CopyIcon;
  const cleanup = useCallback(
    () => () => {
      if (timerRef.current !== null) {
        globalThis.clearTimeout(timerRef.current);
      }
    },
    [],
  );
  const onCopy = async () => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
    }
    try {
      await globalThis.navigator.clipboard.writeText(p.command);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    timerRef.current = globalThis.setTimeout(() => {
      setStatus("idle");
    }, 2000);
  };
  return (
    <span className="eng-copy-wrap" ref={cleanup}>
      <button
        type="button"
        className="button eng-copy-btn"
        aria-label={`Copy command for ${p.packageName}`}
        onClick={() => void onCopy()}
      >
        <Icon aria-hidden="true" />
        Copy command
      </button>
      <span
        role="status"
        className={`eng-copy-status${status === "idle" ? "" : " eng-copy-status-active"}`}
      >
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </span>
  );
}

function VersionDeltaDrawer({
  item,
}: {
  readonly item: RenovateItem;
}): React.JSX.Element {
  const { running, pinned, target, drifted } = versions(item);
  const d = item.delta;
  const behind = d?.versionsBehindCount;
  const cmd = `git fetch origin ${item.branch} && git switch -c fix/${item.branch.replaceAll(/[^\w.-]/gu, "-")} origin/${item.branch}`;
  const pairs: readonly [string, string][] = [
    ["Running version", running === null ? "—" : ver(running)],
    [
      "Pinned version",
      `${pinned === null ? "—" : ver(pinned)}${drifted ? " (differs from running)" : ""}`,
    ],
    ["Target version", target === null ? "—" : ver(target)],
    [
      "Versions behind",
      behind === null || behind === undefined ? "—" : String(behind),
    ],
    ["Evidence source", d?.evidenceSource ?? "none"],
  ];
  return (
    <div className="eng-delta-drawer">
      <dl className="eng-delta-meta">
        {pairs.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="eng-pill-row">
        <span className="muted">Consumers:</span>
        {item.consumers.length === 0 ? (
          <span className="muted">None recorded</span>
        ) : (
          item.consumers.map((c) => (
            <code key={c} className="visual-branch-chip">
              {c}
            </code>
          ))
        )}
      </div>
      {d === undefined ? (
        <div className="eng-delta-box">
          <h4>LLM Version Delta</h4>
          <p>
            Pending enrichment — upstream release notes have not been summarized
            yet.
          </p>
        </div>
      ) : (
        <div className="eng-delta-columns">
          <div className="eng-delta-box">
            <h4>Summary & repo relevance</h4>
            <p>{d.summary}</p>
            <p className="muted">{d.repoRelevance}</p>
            {d.highlights.length === 0 ? null : (
              <ul className="eng-delta-list">
                {d.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
          </div>
          <div
            className={`eng-delta-box${d.breakingChanges.length > 0 ? " eng-delta-box-breaking" : ""}`}
          >
            <h4>Breaking changes & evidence</h4>
            {d.breakingChanges.length === 0 ? (
              <p className="muted">
                No breaking changes flagged in release notes.
              </p>
            ) : (
              <ul className="eng-delta-list">
                {d.breakingChanges.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <div className="eng-pill-row">
              {d.compareUrl === undefined ? null : (
                <ExtLink href={d.compareUrl}>Compare diff </ExtLink>
              )}
              {d.releaseUrls.map((u, idx) => (
                <ExtLink
                  key={u}
                  href={u}
                >{`Release notes ${String(idx + 1)}`}</ExtLink>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="eng-cmd-row">
        <code className="eng-cmd-code">{cmd}</code>
        <CopyCommandButton command={cmd} packageName={item.packageName} />
      </div>
    </div>
  );
}

function nextTabIndex(key: string, idx: number, total: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (idx + 1) % total;
    case "ArrowLeft":
      return (idx - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

export function RenovateQueueTabs<T extends string>(p: {
  readonly renovate: RenovateFacet;
  readonly activeTab: T;
  readonly tabs: readonly {
    readonly id: T;
    readonly label: string;
    readonly count: number;
  }[];
  readonly tabItems: readonly RenovateItem[];
  readonly expandedIds: readonly string[];
  readonly onSelectTab: (tab: T) => void;
}): React.JSX.Element {
  const { renovate, activeTab, tabs, tabItems, expandedIds, onSelectTab } = p;
  const [impact, setImpact] = useState("all");
  const [uType, setUType] = useState("all");
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const filtered = useMemo(
    () =>
      tabItems.filter(
        (i) =>
          (impact === "all" || (i.delta?.impactLevel ?? "none") === impact) &&
          (uType === "all" || i.updateType === uType),
      ),
    [impact, tabItems, uType],
  );
  const columns = useMemo(
    () => buildUpdateColumns(renovate.issueNumber, renovate.issueUrl),
    [renovate.issueNumber, renovate.issueUrl],
  );

  return (
    <>
      <h2 className="block-heading" id="renovate-queue-heading">
        Dependency update queue
      </h2>
      <div
        role="tablist"
        aria-labelledby="renovate-queue-heading"
        className="eng-tablist"
      >
        {tabs.map((tab, idx) => (
          <button
            key={tab.id}
            id={`renovate-tab-${tab.id}`}
            ref={(n) => {
              if (n === null) {
                tabRefs.current.delete(tab.id);
              } else {
                tabRefs.current.set(tab.id, n);
              }
            }}
            role="tab"
            type="button"
            className="eng-tab"
            aria-selected={tab.id === activeTab}
            tabIndex={tab.id === activeTab ? 0 : -1}
            onClick={() => {
              onSelectTab(tab.id);
            }}
            onKeyDown={(e) => {
              const next = nextTabIndex(e.key, idx, tabs.length);
              const target = next === null ? undefined : tabs[next];
              if (target !== undefined) {
                e.preventDefault();
                onSelectTab(target.id);
                tabRefs.current.get(target.id)?.focus();
              }
            }}
          >
            <span>{tab.label}</span>
            <span className="eng-tab-count">{tab.count}</span>
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`renovate-panel-${activeTab}`}
        aria-labelledby={`renovate-tab-${activeTab}`}
        className="eng-tabpanel"
      >
        {activeTab === "merged" ? (
          <DataTable
            caption="Recently merged Renovate pull requests"
            rows={renovate.recentMerged}
            rowKey={(r) => String(r.number)}
            columns={MERGED_COLUMNS}
            initialCap={20}
            searchPlaceholder="Search merged PRs…"
            searchText={(r) =>
              `${String(r.number)} ${r.title} ${r.branch ?? ""}`
            }
            exportFilename="renovate-recent-merges"
            emptyMessage="No recent Renovate merges recorded."
          />
        ) : (
          <DataTable
            key={activeTab}
            caption={`Renovate updates (${activeTab})`}
            rows={filtered}
            rowKey={(i) => i.id}
            rowLabel={(i) => i.packageName}
            columns={columns}
            defaultSort={{ key: "impact", direction: "descending" }}
            initialCap={20}
            searchPlaceholder="Search package, title, branch, or delta…"
            searchText={(i) =>
              `${i.packageName} ${i.ecosystem} ${i.title} ${i.branch} ${i.delta?.summary ?? ""}`
            }
            filters={[
              {
                key: "impact",
                label: "Impact level",
                value: impact,
                onChange: setImpact,
                options: IMPACT_OPTIONS,
              },
              {
                key: "updateType",
                label: "Update type",
                value: uType,
                onChange: setUType,
                options: TYPE_OPTIONS,
              },
            ]}
            exportFilename="renovate-updates"
            renderExpanded={(i) => <VersionDeltaDrawer item={i} />}
            initialExpandedKeys={expandedIds}
            emptyMessage="No Renovate updates in this bucket."
          />
        )}
        {activeTab === "hygiene" ? (
          <DataTable
            caption="Deprecated dependencies"
            rows={renovate.deprecations}
            rowKey={(d) => d.current}
            columns={DEPRECATION_COLUMNS}
            initialCap={20}
            exportFilename="renovate-deprecations"
            emptyMessage="No deprecated dependencies detected."
          />
        ) : null}
      </section>
    </>
  );
}
