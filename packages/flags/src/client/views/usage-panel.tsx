import { useId } from "react";
import { FileCodeIcon } from "lucide-react";
import { Tag } from "@shepherdjerred/console-ui";
import type { FlagsUsageResponse as FlagsUsage } from "@shepherdjerred/feature-flags/flags-wire.ts";
import {
  useUsage,
  type ReadSite,
} from "@shepherdjerred/flags/client/management-api.ts";
import { formatInstant, relativeTime } from "./history-model.ts";

const REPOSITORY_BLOB = "https://github.com/shepherdjerred/monorepo/blob/main/";

/** A read site's file on GitHub's `main`. */
export function sourceUrl(file: string): string {
  const path = file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${REPOSITORY_BLOB}${path}`;
}

type FileSites = {
  readonly file: string;
  readonly sites: readonly ReadSite[];
};

type PackageSites = {
  readonly name: string;
  readonly files: readonly FileSites[];
};

/** Read sites grouped by package, then file, each sorted by name. */
export function groupReadSites(
  sites: readonly ReadSite[],
): readonly PackageSites[] {
  const packages = new Map<string, Map<string, ReadSite[]>>();
  for (const site of sites) {
    const files = packages.get(site.package) ?? new Map<string, ReadSite[]>();
    packages.set(site.package, files);
    files.set(site.file, [...(files.get(site.file) ?? []), site]);
  }
  return [...packages.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => ({
      name,
      files: [...files.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([file, fileSites]) => ({ file, sites: fileSites })),
    }));
}

/**
 * A deployment's consumer liveness: when a consumer last fetched its snapshot
 * on the evaluation port, or since when none has (the server's start; its
 * counters reset on every restart). Undefined for a deployment not stored.
 */
export function livenessText(
  usage: FlagsUsage,
  deployment: string,
  now: number,
): { readonly text: string; readonly title: string } | undefined {
  const entry = usage.deployments.find(
    (candidate) => candidate.id === deployment,
  );
  if (entry === undefined) return undefined;
  const counts = `${String(entry.fetches200)} full, ${String(entry.fetches304)} not modified since ${formatInstant(usage.since)}`;
  return entry.lastFetchedAt === null
    ? {
        text: `No consumer fetch since ${formatInstant(usage.since)}`,
        title: "Counters reset when the Flags server restarts",
      }
    : {
        text: `Last fetched ${relativeTime(entry.lastFetchedAt, now)}`,
        title: `${formatInstant(entry.lastFetchedAt)} · ${counts}`,
      };
}

/** The liveness line for one deployment; nothing while usage loads or fails. */
export function FetchLiveness({
  deployment,
  className = "fl-liveness",
}: {
  readonly deployment: string;
  readonly className?: string;
}): React.JSX.Element | null {
  const usage = useUsage();
  if (usage.data === undefined) return null;
  const liveness = livenessText(usage.data, deployment, usage.dataUpdatedAt);
  return liveness === undefined ? null : (
    <span className={className} title={liveness.title}>
      {liveness.text}
    </span>
  );
}

function JavaEvaluation({
  usage,
  deployment,
  flagKey,
  now,
}: {
  readonly usage: FlagsUsage;
  readonly deployment: string;
  readonly flagKey: string;
  readonly now: number;
}): React.JSX.Element {
  const entry = usage.evaluations.find(
    (candidate) =>
      candidate.deployment === deployment && candidate.key === flagKey,
  );
  return (
    <p className="ui-muted fl-usage-eval">
      {entry === undefined ? (
        `No Java client evaluation since ${formatInstant(usage.since)}`
      ) : (
        <span title={formatInstant(entry.lastEvaluatedAt)}>
          Last evaluated by the Java client{" "}
          {relativeTime(entry.lastEvaluatedAt, now)}
        </span>
      )}
    </p>
  );
}

/**
 * "Read by": the committed static index's read sites for a key, grouped by
 * package, each file linked to `main`. A key without one reads "No static
 * reference found": the index is syntactic, so absence is not proof a key is
 * unused. A Java-read key also shows when the Java client last evaluated it.
 */
export function UsagePanel({
  catalog,
  stage,
  flagKey,
}: {
  readonly catalog: string;
  readonly stage: string;
  readonly flagKey: string;
}): React.JSX.Element {
  const headingId = useId();
  const usage = useUsage();
  const sites = usage.data?.static.flags[flagKey] ?? [];
  return (
    <section className="fl-usage" aria-labelledby={headingId}>
      <h3 id={headingId} className="fl-history-title">
        <FileCodeIcon aria-hidden="true" />
        Read by
      </h3>
      {usage.isPending ? (
        <p className="ui-muted" role="status">
          Loading read sites…
        </p>
      ) : usage.isError ? (
        <p className="ui-field-error" role="alert">
          Read sites failed to load: {usage.error.message}
        </p>
      ) : sites.length === 0 ? (
        <p className="ui-muted fl-usage-none">No static reference found</p>
      ) : (
        <ul className="fl-usage-packages">
          {groupReadSites(sites).map((group) => (
            <li key={group.name}>
              <span className="ui-mono fl-usage-package">{group.name}</span>
              <ul className="fl-usage-files">
                {group.files.map((entry) => (
                  <li key={entry.file} className="fl-usage-file">
                    <a
                      className="ui-mono"
                      href={sourceUrl(entry.file)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.file}
                    </a>
                    {entry.sites.map((site) => (
                      <Tag key={site.kind} className="fl-usage-kind">
                        {site.count > 1
                          ? `${site.kind} ×${String(site.count)}`
                          : site.kind}
                      </Tag>
                    ))}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {usage.data !== undefined &&
      sites.some((site) => site.kind === "java") ? (
        <JavaEvaluation
          usage={usage.data}
          deployment={`${catalog}/${stage}`}
          flagKey={flagKey}
          now={usage.dataUpdatedAt}
        />
      ) : null}
    </section>
  );
}
