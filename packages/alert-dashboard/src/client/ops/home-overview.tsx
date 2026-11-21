import type {
  SectionId,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";

import { AttentionPanel } from "./attention-panel.tsx";
import { GlanceTiles } from "./glance-tiles.tsx";
import { NewSinceLastVisit } from "./new-since-last-visit.tsx";
import { SectionCard, SnapshotBlock, StatusBanner } from "./ops-ui.tsx";

/** Where each section's card links for its detail. */
const SECTION_PAGES: Partial<Record<SectionId, string>> = {
  alerts: "/alerts",
  delivery: "/delivery",
  work: "/delivery",
  ai: "/ai",
  maintenance: "/maintenance",
  errors: "/maintenance",
  platform: "/maintenance",
  observability: "/maintenance",
  product: "/services",
};

/**
 * Ordered so the first screen answers "is anything wrong, and where": the
 * overall status, the three headline numbers, then every area. The lists that
 * take reading sit below.
 */
function Overview({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const newIds = new Set(snapshot.newSignalIds);
  return (
    <>
      <StatusBanner snapshot={snapshot} />
      <GlanceTiles snapshot={snapshot} />
      <h2 className="block-heading">Areas</h2>
      <section className="section-grid" aria-label="Areas">
        {snapshot.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            {...(SECTION_PAGES[section.id] === undefined
              ? {}
              : { to: SECTION_PAGES[section.id] })}
          />
        ))}
      </section>
      <div className="home-columns">
        <AttentionPanel snapshot={snapshot} newIds={newIds} />
        <NewSinceLastVisit snapshot={snapshot} />
      </div>
    </>
  );
}

/** The core module's Home block: the whole ops overview. */
export function OpsHomeOverview(): React.JSX.Element {
  return (
    <SnapshotBlock title="overview">
      {(snapshot) => <Overview snapshot={snapshot} />}
    </SnapshotBlock>
  );
}
