import { ExternalLinkIcon } from "lucide-react";
import { Suspense } from "react";
import { Link } from "react-router";

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
    <>
      <h3 id={id}>{title}</h3>
      <ul className="launcher-grid" aria-labelledby={id}>
        {entries.map((entry) => (
          <li key={entry.url}>
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
    </>
  );
}

function Launcher(): React.JSX.Element {
  const { nav } = useRegistry();
  return (
    <section aria-labelledby="launcher-heading">
      <h2 className="block-heading" id="launcher-heading">
        Launcher
      </h2>
      <h3 id="launcher-pages">Pages</h3>
      <ul className="launcher-grid" aria-labelledby="launcher-pages">
        {nav
          .filter((item) => item.to !== "/")
          .map((item) => (
            <li key={item.to}>
              <Link className="launcher-card" to={item.to}>
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
      </ul>
      <ExternalGroup title="Apps" entries={APPS} />
      <ExternalGroup title="Tools" entries={TOOLS} />
    </section>
  );
}

/**
 * The landing page: every module's Home block, then a launcher for the
 * app's own pages and the tools around it. The launcher is static, so it
 * stays usable when a module's data is unavailable.
 */
export function HomePage(): React.JSX.Element {
  const { modules } = useRegistry();
  return (
    <main>
      <title>Home · Ops</title>
      <PageHeading eyebrow="Homelab" title="Home" />
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
