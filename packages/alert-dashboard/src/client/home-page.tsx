import { ExternalLinkIcon } from "lucide-react";
import { Suspense } from "react";

import { APPS, TOOLS, type ExternalEntry } from "./external-links.ts";
import { PageHeading } from "./ops/ops-ui.tsx";
import { useRegistry } from "./platform/registry.tsx";

function ExternalGroup({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly ExternalEntry[];
}): React.JSX.Element {
  const id = `launcher-${title.toLowerCase()}`;
  return (
    <div className="launcher-group">
      <h3 id={id}>{title}</h3>
      <ul className="launcher-grid" aria-labelledby={id}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              className="launcher-card"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
            >
              <entry.icon aria-hidden="true" />
              <span>{entry.label}</span>
              <ExternalLinkIcon
                className="launcher-external"
                aria-hidden="true"
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Launcher(): React.JSX.Element {
  return (
    <section aria-labelledby="launcher-heading">
      <h2 className="block-heading" id="launcher-heading">
        Launcher
      </h2>
      <div className="launcher-groups">
        <ExternalGroup title="Apps" entries={APPS} />
        <ExternalGroup title="Tools" entries={TOOLS} />
      </div>
    </section>
  );
}

/**
 * The landing page: every module's Home block, the ops overview first, then a
 * launcher for the other apps and the tools. The app's own pages are in the
 * sidebar. The launcher is static, so it stays usable when a module's data is
 * unavailable.
 */
export function HomePage(): React.JSX.Element {
  const { modules } = useRegistry();
  return (
    <main className="home">
      <title>Home · Hub</title>
      <PageHeading title="Home" />
      {modules.flatMap((module) =>
        (module.homeCards ?? []).map((entry) => (
          <Suspense
            key={`${module.id}:${entry.id}`}
            fallback={<div className="loading-state">Loading…</div>}
          >
            <entry.card />
          </Suspense>
        )),
      )}
      <Launcher />
    </main>
  );
}
