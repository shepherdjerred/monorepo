/**
 * Pure paging state for the frozen-snapshot Bucks ledger.
 *
 * The backend freezes a maximum ledger id on the first page read and echoes it
 * back; every later page must resend it so new entries cannot reshuffle pages
 * mid-navigation. "Refresh" drops the snapshot to re-freeze at the newest
 * entry.
 */

export type BucksLedgerPagingState = {
  page: number;
  snapshotId: number | undefined;
};

export const INITIAL_LEDGER_PAGING: BucksLedgerPagingState = {
  page: 0,
  snapshotId: undefined,
};

/** Adopt the server's frozen snapshot id after the first page answers. */
export function adoptSnapshot(
  state: BucksLedgerPagingState,
  serverSnapshotId: number | null,
): BucksLedgerPagingState {
  if (serverSnapshotId === null || state.snapshotId !== undefined) {
    return state;
  }
  return { ...state, snapshotId: serverSnapshotId };
}

export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 0), Math.max(totalPages - 1, 0));
}

export function nextPage(
  state: BucksLedgerPagingState,
  totalPages: number,
): BucksLedgerPagingState {
  return { ...state, page: clampPage(state.page + 1, totalPages) };
}

export function previousPage(
  state: BucksLedgerPagingState,
  totalPages: number,
): BucksLedgerPagingState {
  return { ...state, page: clampPage(state.page - 1, totalPages) };
}
