import { PanelError, PanelLoading, PanelMessage } from "./bits.tsx";
import { useRecentRaces } from "./queries.ts";
import { RaceList } from "./race-list.tsx";

export function RecentRacesPanel() {
  const query = useRecentRaces();
  if (query.isPending) {
    return <PanelLoading />;
  }
  if (query.isError) {
    return (
      <PanelError
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <PanelMessage title="No races yet">
        Finished races show up here the moment they end.
      </PanelMessage>
    );
  }
  return <RaceList races={query.data} nowMs={Date.now()} />;
}
