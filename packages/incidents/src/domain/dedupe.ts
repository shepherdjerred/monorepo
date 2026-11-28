/**
 * One open `incident`-kind record per system. Maintenance never dedupes (two
 * windows may overlap), and `other` never dedupes because it names no shared
 * system. The persistence layer enforces the same rule with a primary key so
 * concurrent declarations cannot both win.
 */
import { isOpenStatus, type IncidentSystem } from "#shared/contract.ts";
import { duplicateIncident } from "#domain/errors.ts";
import type { IncidentRecord } from "#domain/model.ts";

type DedupeShape = Pick<IncidentRecord, "kind" | "status" | "systems">;

/** Systems this record holds exclusively while it stays open. */
export function heldSystems(record: DedupeShape): IncidentSystem[] {
  return record.kind === "incident" && isOpenStatus(record.status)
    ? [...new Set(record.systems)].filter((system) => system !== "other")
    : [];
}

/** The first open record (other than `selfId`) holding any of `candidate`'s systems. */
export function findOverlap(
  candidate: DedupeShape,
  open: readonly IncidentRecord[],
  selfId?: string,
): { existing: IncidentRecord; systems: IncidentSystem[] } | null {
  const wanted = heldSystems(candidate);
  if (wanted.length === 0) return null;
  for (const existing of open) {
    if (existing.id === selfId) continue;
    const held = new Set(heldSystems(existing));
    const systems = wanted.filter((system) => held.has(system));
    if (systems.length > 0) return { existing, systems };
  }
  return null;
}

/** Throw the caller-facing duplicate conflict when `candidate` overlaps an open incident. */
export function assertNoOverlap(
  candidate: DedupeShape,
  open: readonly IncidentRecord[],
  selfId?: string,
): void {
  const overlap = findOverlap(candidate, open, selfId);
  if (overlap !== null)
    throw duplicateIncident(overlap.existing, overlap.systems);
}
