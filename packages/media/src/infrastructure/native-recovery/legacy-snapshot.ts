import { assertDefaultEdition } from "#shared/editions/scope.ts";

/** Historical review JSON predates the storage key. Preserve its original shape. */
export function historicalDefaultRow<T extends { edition: string }>(
  row: T,
): Omit<T, "edition"> {
  assertDefaultEdition(row.edition);
  const { edition: _edition, ...historical } = row;
  return historical;
}

/** Availability/root are new target storage, not fields of an old intent receipt. */
export function historicalDefaultIntent<
  T extends {
    edition: string;
    editionRootId: string | null;
    availability: string;
    libraryMonitoring?: boolean;
  },
>(
  row: T,
): Omit<T, "edition" | "editionRootId" | "availability" | "libraryMonitoring"> {
  assertDefaultEdition(row.edition);
  const {
    edition: _edition,
    editionRootId: _root,
    availability: _availability,
    libraryMonitoring: _libraryMonitoring,
    ...historical
  } = row;
  return historical;
}
