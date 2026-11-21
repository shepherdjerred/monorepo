import { HistoryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import {
  useBrowseGuild,
  useParamState,
} from "@shepherdjerred/streambot/web/client/library/browse-state.ts";
import { DisabledPage } from "@shepherdjerred/streambot/web/client/library/disabled-page.tsx";
import {
  FilterBar,
  SelectFilter,
  TextFilter,
} from "@shepherdjerred/streambot/web/client/library/filters.tsx";
import { PageHeading } from "@shepherdjerred/streambot/web/client/library/page-heading.tsx";
import { Pager } from "@shepherdjerred/streambot/web/client/library/pager.tsx";
import { PAGE_SIZE } from "@shepherdjerred/streambot/web/client/library/paging.ts";
import { historyItem, PROVIDER_FILTERS } from "./history-items.ts";
import { historyUrl, readHistoryFilters } from "./history-query.ts";

const VISIBILITY = [
  { value: "mine", label: "My plays" },
  { value: "server", label: "Everyone in this server" },
] as const;

export function HistoryPage() {
  const remote = useRemote();
  const guildId = useBrowseGuild();
  const { params, update, href } = useParamState();
  const filters = readHistoryFilters(params);
  const capabilities = remote.room?.capabilities;
  const enabled = capabilities?.history === true;
  const load = useLoad(
    enabled && guildId !== "" ? historyUrl(guildId, filters) : null,
    HistoryPageSchema,
  );
  if (capabilities !== undefined && !capabilities.history)
    return (
      <DisabledPage
        title="History"
        reason="Playback history is not enabled in this server."
      />
    );
  const listen = capabilities?.listen === true;
  const total = load.state.status === "done" ? load.state.data.total : 0;
  return (
    <div className="page">
      <PageHeading title="History" />
      <FilterBar label="History filters">
        <TextFilter
          label="Filter by title"
          placeholder="Something played before"
          value={filters.query}
          onApply={(value) => {
            update({ q: value });
          }}
        />
        <SelectFilter
          label="Show"
          value={filters.visibility}
          options={VISIBILITY}
          onChange={(value) => {
            update({ visibility: value === "server" ? "server" : "" });
          }}
        />
        <SelectFilter
          label="Source"
          value={filters.provider}
          options={PROVIDER_FILTERS}
          onChange={(value) => {
            update({ provider: value });
          }}
        />
      </FilterBar>
      <ItemSection
        title={
          filters.visibility === "mine" ? "Your plays" : "Plays in this server"
        }
        load={load.state}
        onRetry={load.retry}
        items={(data) => data.items.map((entry) => historyItem(entry, listen))}
        empty="No plays found. Try another filter, or play something."
        aside={
          load.state.status === "done" ? (
            <span className="muted numeric">{total} in all</span>
          ) : undefined
        }
      />
      <Pager
        label="History pages"
        offset={filters.offset}
        total={total}
        size={PAGE_SIZE}
        hrefFor={(offset) => href({ offset: String(offset) })}
      />
    </div>
  );
}
