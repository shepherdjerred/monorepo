import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { BucksLedgerList } from "#src/components/bucks-ledger-list.tsx";
import {
  INITIAL_LEDGER_PAGING,
  adoptSnapshot,
  nextPage,
  previousPage,
} from "#src/lib/bucks-ledger-paging.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { useBucksGuild } from "#src/routes/bucks-workspace.tsx";

/**
 * The caller's own ledger, paged against a frozen snapshot id so new entries
 * cannot reshuffle pages mid-navigation. "Refresh" drops the snapshot to
 * re-freeze at the newest entry.
 */
export function BucksHistory() {
  const { guildId } = useBucksGuild();
  const trpc = useTRPC();
  const [paging, setPaging] = useState(INITIAL_LEDGER_PAGING);

  const query = useQuery(
    trpc.bucks.ledger.queryOptions(
      {
        guildId,
        page: paging.page,
        ...(paging.snapshotId === undefined
          ? {}
          : { snapshotId: paging.snapshotId }),
      },
      { placeholderData: keepPreviousData },
    ),
  );

  if (query.isPending) {
    return <LoadingState label="Loading your history…" />;
  }
  if (query.isError) {
    return (
      <ErrorState
        message="Scout couldn't load your Bryan Bucks history."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const page = query.data;
  return (
    <BucksLedgerList
      entries={page.entries}
      page={page.page}
      totalPages={page.totalPages}
      onPreviousPage={() => {
        setPaging((current) =>
          previousPage(
            adoptSnapshot(current, page.snapshotId),
            page.totalPages,
          ),
        );
      }}
      onNextPage={() => {
        setPaging((current) =>
          nextPage(adoptSnapshot(current, page.snapshotId), page.totalPages),
        );
      }}
      onRefresh={() => {
        setPaging(INITIAL_LEDGER_PAGING);
        void query.refetch();
      }}
    />
  );
}
