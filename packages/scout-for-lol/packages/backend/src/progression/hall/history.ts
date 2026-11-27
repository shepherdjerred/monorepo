import {
  classifyHallQueueFamily,
  isHallEligibleMatch,
  type HallRecordId,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  fetchProgressionMatches,
  type ProgressionMatchCursor,
  type ProgressionMatchRow,
} from "#src/progression/progression-lake-reads.ts";
import {
  addHallCandidate,
  hallCandidateFor,
  hallCellKey,
  hallHolderFor,
  type HallStandings,
  type HallTrackedAccount,
} from "./rankings.ts";

const PAGE_SIZE = 10_000;

function considerMatch(
  values: Map<string, HallStandings>,
  match: ProgressionMatchRow,
  account: HallTrackedAccount,
  catalog: {
    readonly targetCellKeys: ReadonlySet<string>;
    readonly recordIds: readonly HallRecordId[];
  },
): void {
  if (!isHallEligibleMatch(match, account.createdTime)) {
    return;
  }
  const family = classifyHallQueueFamily(match.queue);
  if (family === null) {
    return;
  }
  const holder = hallHolderFor(account);
  for (const recordId of catalog.recordIds) {
    const key = hallCellKey(family, recordId);
    if (!catalog.targetCellKeys.has(key)) {
      continue;
    }
    values.set(
      key,
      addHallCandidate(
        values.get(key) ?? [],
        hallCandidateFor(match, holder, family, recordId),
      ),
    );
  }
}

function nextCursor(
  rows: readonly ProgressionMatchRow[],
): ProgressionMatchCursor {
  const last = rows.at(-1);
  if (last === undefined) {
    throw new Error("Cannot advance an empty Hall page");
  }
  return {
    gameEndMs: last.game_end_ms,
    matchId: last.match_id,
    puuid: last.puuid,
  };
}

type IncomingMatch = {
  readonly gameEndMs: number;
  readonly matchId: RiotMatchId;
};

function precedes(
  match: ProgressionMatchRow,
  incoming: IncomingMatch,
): boolean {
  return (
    match.match_id !== incoming.matchId &&
    (match.game_end_ms < incoming.gameEndMs ||
      (match.game_end_ms === incoming.gameEndMs &&
        match.match_id < incoming.matchId))
  );
}

/** Fold eligible lake history using the same scoring and tie rules as live play. */
export async function calculateHallStandings(options: {
  readonly accounts: readonly HallTrackedAccount[];
  readonly targetCellKeys: ReadonlySet<string>;
  readonly recordIds: readonly HallRecordId[];
  readonly before?: IncomingMatch;
  readonly initial?: ReadonlyMap<string, HallStandings>;
  readonly onProgress?: ((rows: number) => void) | undefined;
}): Promise<Map<string, HallStandings>> {
  const values = new Map(options.initial);
  if (options.accounts.length === 0 || options.targetCellKeys.size === 0) {
    return values;
  }

  const earliest = options.accounts.reduce(
    (minimum, account) => Math.min(minimum, account.createdTime.getTime()),
    Number.POSITIVE_INFINITY,
  );
  const byPuuid = new Map(
    options.accounts.map((account) => [account.puuid, account]),
  );
  let cursor: ProgressionMatchCursor | undefined;
  let processed = 0;
  const { before } = options;
  for (;;) {
    const rows = await fetchProgressionMatches({
      puuids: [...byPuuid.keys()],
      startAt: new Date(earliest),
      ...(before === undefined ? {} : { endAt: new Date(before.gameEndMs) }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: PAGE_SIZE,
    });
    const priorRows =
      before === undefined ? rows : rows.filter((row) => precedes(row, before));
    for (const match of priorRows) {
      const account = byPuuid.get(match.puuid);
      if (account === undefined) {
        throw new Error(`Hall lake returned unrequested PUUID ${match.puuid}`);
      }
      considerMatch(values, match, account, options);
    }
    processed += rows.length;
    options.onProgress?.(processed);
    if (rows.length < PAGE_SIZE) {
      return values;
    }
    cursor = nextCursor(rows);
  }
}
