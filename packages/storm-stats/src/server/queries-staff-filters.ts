import type {
  ActivityGroup,
  Platform,
  PlayerDirectoryRow,
  PlayerSortField,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { DAY_MS, HOUR_MS, toPacificDay } from "./time.ts";

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export type StaffQueryFilters = {
  readonly search?: string;
  readonly activityGroups?: readonly ActivityGroup[];
  readonly platform?: Platform;
  readonly primaryGroup?: string;
  readonly countryCode?: string;
  readonly joinAddress?: string;
  readonly town?: string;
  readonly registeredAfter?: string;
  readonly registeredBefore?: string;
  readonly lastSeenAfter?: string;
  readonly lastSeenBefore?: string;
  readonly minActiveHours?: number;
  readonly maxActiveHours?: number;
  readonly minSessions?: number;
  readonly minActivityIndex?: number;
  readonly seenWithinDays?: number;
  readonly registeredWithinDays?: number;
  readonly hasBounces?: boolean;
  readonly online?: boolean;
  readonly sort?: PlayerSortField;
  readonly order?: "asc" | "desc";
  readonly limit?: number;
};

type RowPredicate = (
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
  nowMs: number,
) => boolean;

function caseInsensitiveEquals(
  actual: string | null | undefined,
  expected: string | undefined,
): boolean {
  return (
    expected === undefined ||
    expected.length === 0 ||
    (actual ?? "").toLowerCase() === expected.toLowerCase()
  );
}

function checkActivityGroups(
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
): boolean {
  const groups = filters.activityGroups;
  return (
    groups === undefined ||
    groups.length === 0 ||
    groups.includes(row.activityGroup)
  );
}

function checkPlatformAndGroups(
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
): boolean {
  return (
    (filters.platform === undefined || row.platform === filters.platform) &&
    caseInsensitiveEquals(row.primaryGroup, filters.primaryGroup) &&
    caseInsensitiveEquals(row.staff?.countryCode, filters.countryCode) &&
    caseInsensitiveEquals(row.townName, filters.town)
  );
}

function checkJoinAndSearch(
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
): boolean {
  if (
    filters.joinAddress !== undefined &&
    filters.joinAddress.length > 0 &&
    !(row.staff?.lastJoinAddress ?? "")
      .toLowerCase()
      .includes(filters.joinAddress.toLowerCase())
  ) {
    return false;
  }
  const q = filters.search?.trim().toLowerCase();
  if (q === undefined || q.length === 0) {
    return true;
  }
  const haystack = [
    row.name,
    row.nickname ?? "",
    row.uuid,
    row.townName ?? "",
    row.staff?.lastJoinAddress ?? "",
    row.staff?.countryCode ?? "",
    row.staff?.countryName ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function checkPlaytimeAndCounts(
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
): boolean {
  return (
    (filters.minActiveHours === undefined ||
      row.activeMs >= filters.minActiveHours * HOUR_MS) &&
    (filters.maxActiveHours === undefined ||
      row.activeMs <= filters.maxActiveHours * HOUR_MS) &&
    (filters.minSessions === undefined ||
      row.sessionsCount >= filters.minSessions) &&
    (filters.minActivityIndex === undefined ||
      row.activityIndex >= filters.minActivityIndex)
  );
}

function checkDateWindow(
  isoTimestamp: string,
  afterDay: string | undefined,
  beforeDay: string | undefined,
): boolean {
  const day = toPacificDay(new Date(isoTimestamp));
  if (
    afterDay !== undefined &&
    ISO_DAY_PATTERN.test(afterDay) &&
    day < afterDay
  ) {
    return false;
  }
  if (
    beforeDay !== undefined &&
    ISO_DAY_PATTERN.test(beforeDay) &&
    day > beforeDay
  ) {
    return false;
  }
  return true;
}

function checkRecencyAndFlags(
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
  nowMs: number,
): boolean {
  if (
    !checkDateWindow(
      row.firstSeenAt,
      filters.registeredAfter,
      filters.registeredBefore,
    ) ||
    !checkDateWindow(
      row.lastSeenAt,
      filters.lastSeenAfter,
      filters.lastSeenBefore,
    )
  ) {
    return false;
  }
  if (filters.seenWithinDays !== undefined) {
    const cutoff = new Date(
      nowMs - filters.seenWithinDays * DAY_MS,
    ).toISOString();
    if (row.lastSeenAt < cutoff) {
      return false;
    }
  }
  if (filters.registeredWithinDays !== undefined) {
    const cutoff = new Date(
      nowMs - filters.registeredWithinDays * DAY_MS,
    ).toISOString();
    if (row.firstSeenAt < cutoff) {
      return false;
    }
  }
  return (
    (filters.hasBounces === undefined ||
      (row.staff?.bouncesCount ?? 0) > 0 === filters.hasBounces) &&
    (filters.online === undefined || row.online === filters.online)
  );
}

const PREDICATES: readonly RowPredicate[] = [
  checkActivityGroups,
  checkPlatformAndGroups,
  checkJoinAndSearch,
  checkPlaytimeAndCounts,
  checkRecencyAndFlags,
];

export function matchesStaffQueryFilters(
  row: PlayerDirectoryRow,
  filters: StaffQueryFilters,
  nowMs: number,
): boolean {
  return PREDICATES.every((fn) => fn(row, filters, nowMs));
}
