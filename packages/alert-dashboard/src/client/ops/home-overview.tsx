import type {
  Signal,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { useQuery } from "@tanstack/react-query";

import { AttentionPanel, AttentionTabs } from "./attention-panel.tsx";
import { AreasTable } from "./areas-table.tsx";
import { GlanceTiles } from "./glance-tiles.tsx";
import { NewSinceLastVisit } from "./new-since-last-visit.tsx";
import { snapshotQuery } from "./ops-api.ts";
import { SnapshotAge, SnapshotBlock, SnapshotStatusBanner } from "./ops-ui.tsx";

/**
 * Ordered so the first screen answers "is anything wrong, and where": the
 * overall verdict, the headline figures, then every area. The lists that
 * take reading sit below.
 */
function Overview({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const newIds = new Set(snapshot.newSignalIds);
  const titles = new Map(
    snapshot.sections.map((section) => [section.id, section.title]),
  );
  const areaTitle = (signal: Signal): string =>
    titles.get(signal.section) ?? signal.section;
  return (
    <>
      <SnapshotStatusBanner snapshot={snapshot} />
      <GlanceTiles snapshot={snapshot} />
      <AreasTable snapshot={snapshot} />
      <AttentionPanel
        snapshot={snapshot}
        newIds={newIds}
        areaTitle={areaTitle}
      />
      <NewSinceLastVisit snapshot={snapshot} areaTitle={areaTitle} />
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

/**
 * Home's header controls from the latest snapshot: the attention filter as
 * view tabs and the snapshot's age. Before the first snapshot loads, the
 * header is the title alone.
 */
export function useOpsHomeHeader(): {
  readonly tabs?: React.JSX.Element;
  readonly meta?: React.JSX.Element;
} {
  const { data } = useQuery(snapshotQuery());
  return data === undefined
    ? {}
    : {
        tabs: <AttentionTabs snapshot={data} />,
        meta: <SnapshotAge snapshot={data} />,
      };
}
