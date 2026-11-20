import { expect, test } from "vitest";
import {
  ARTWORK_BACKFILL_PER_PAGE,
  artworkBackfillTurn,
} from "./artwork-backfill.ts";

const PAGE = 50;
const TURNS = PAGE / ARTWORK_BACKFILL_PER_PAGE;

function slots(count: number, from = 0): number[] {
  return Array.from({ length: count }, (_, index) => from + index);
}

test("ten or fewer candidates are all tried every period", () => {
  const candidates = [3, 17, 18, 31, 49];
  for (let period = 0; period < 2 * TURNS; period++)
    expect(
      artworkBackfillTurn(candidates, PAGE, period).toSorted((a, b) => a - b),
    ).toEqual(candidates);
});

test("a turn never exceeds the page budget", () => {
  for (let period = 0; period < 2 * TURNS; period++)
    expect(artworkBackfillTurn(slots(PAGE), PAGE, period)).toHaveLength(
      ARTWORK_BACKFILL_PER_PAGE,
    );
});

test("a full page of never-observed candidates is covered in five successive periods", () => {
  const tried = new Set<number>();
  for (let period = 7; period < 7 + TURNS; period++) {
    const turn = artworkBackfillTurn(slots(PAGE), PAGE, period);
    for (const slot of turn) expect(tried.has(slot)).toBe(false);
    for (const slot of turn) tried.add(slot);
  }
  expect([...tried].toSorted((a, b) => a - b)).toEqual(slots(PAGE));
});

// The review finding: ten titles whose refresh always fails sit first in the
// page and are never observed, so they stay candidates in every period.
test("ten permanently failing candidates cannot keep later ones from their turn", () => {
  const failing = slots(10);
  const healthy = new Set([10, 11, 24, 37, 49]);
  for (let period = 0; period < TURNS; period++) {
    const turn = artworkBackfillTurn(
      [...failing, ...healthy],
      PAGE,
      1000 + period,
    );
    // A healthy title is observed by its refresh and stops being a candidate.
    for (const slot of turn) healthy.delete(slot);
  }
  expect([...healthy]).toEqual([]);
});

test("every candidate is tried within five consecutive periods, whatever else is on the page", () => {
  const pages = [
    slots(11),
    slots(23, 9),
    slots(PAGE).filter((slot) => slot % 3 !== 1),
    [...slots(12), ...slots(12, 38)],
  ];
  for (const candidates of pages)
    for (let first = 0; first < TURNS; first++) {
      const tried = new Set(
        slots(TURNS, first).flatMap((period) =>
          artworkBackfillTurn(candidates, PAGE, period),
        ),
      );
      expect([...tried].toSorted((a, b) => a - b)).toEqual(candidates);
    }
});
