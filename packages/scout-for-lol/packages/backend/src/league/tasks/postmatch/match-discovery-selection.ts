import { DareTargetBindingV2Schema } from "@scout-for-lol/data";
import type { PlayerConfigEntry } from "@scout-for-lol/data";
import { shouldCheckPlayer } from "#src/utils/polling-intervals.ts";

export type MatchPollAccount = {
  config: PlayerConfigEntry;
  lastMatchTime: Date | undefined;
  lastCheckedAt: Date | undefined;
};

function puuidOf(account: MatchPollAccount): string {
  return account.config.league.leagueAccount.puuid;
}

function checkedAtValue(account: MatchPollAccount): number {
  return account.lastCheckedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function uniquePollAccounts(
  accounts: readonly MatchPollAccount[],
): MatchPollAccount[] {
  const byPuuid = new Map<string, MatchPollAccount>();
  for (const account of accounts) {
    const puuid = puuidOf(account);
    const previous = byPuuid.get(puuid);
    if (
      previous === undefined ||
      checkedAtValue(account) < checkedAtValue(previous)
    ) {
      byPuuid.set(puuid, account);
    }
  }
  return [...byPuuid.values()];
}

export function activeDareTargetPuuids(
  targets: readonly { accounts: string }[],
): Set<string> {
  const result = new Set<string>();
  for (const target of targets) {
    const accounts = DareTargetBindingV2Schema.shape.accounts.parse(
      JSON.parse(target.accounts),
    );
    for (const account of accounts) result.add(account.puuid);
  }
  return result;
}

export function selectMatchPollAccounts(input: {
  accounts: readonly MatchPollAccount[];
  requiredPuuids: ReadonlySet<string>;
  currentTime: Date;
  ordinaryLimit: number;
}): MatchPollAccount[] {
  const accounts = uniquePollAccounts(input.accounts);
  const availablePuuids = new Set(accounts.map((account) => puuidOf(account)));
  const unavailableRequired = [...input.requiredPuuids]
    .filter((puuid) => !availablePuuids.has(puuid))
    .toSorted();
  if (unavailableRequired.length > 0) {
    throw new Error(
      `Active Dare v2 target account(s) are unavailable for live polling: ${unavailableRequired.join(", ")}`,
    );
  }

  const required = accounts
    .filter((account) => input.requiredPuuids.has(puuidOf(account)))
    .toSorted((left, right) => puuidOf(left).localeCompare(puuidOf(right)));
  const ordinary = accounts
    .filter(
      (account) =>
        !input.requiredPuuids.has(puuidOf(account)) &&
        shouldCheckPlayer(
          account.lastMatchTime,
          account.lastCheckedAt,
          input.currentTime,
        ),
    )
    .toSorted(
      (left, right) =>
        checkedAtValue(left) - checkedAtValue(right) ||
        puuidOf(left).localeCompare(puuidOf(right)),
    );
  const ordinarySlots = Math.max(0, input.ordinaryLimit - required.length);
  return [...required, ...ordinary.slice(0, ordinarySlots)];
}
