import { expect, test } from "vitest";
import {
  ARTWORK_BACKFILL_PER_PAGE,
  ARTWORK_ROOT_BACKFILL_PER_PERIOD as ROOT_BUDGET,
  artworkBackfillTurn,
  artworkRootBackfillTurn,
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

/** The positions a period's turn reads, in the order it reads them. */
function rootTurn(count: number, period: number): number[] {
  return artworkRootBackfillTurn(count, period).flatMap(({ skip, take }) =>
    slots(take, skip),
  );
}

/**
 * Runs the backfill from `first` until only roots TMDB never answers for are
 * left, and returns how many periods that took. A root that is observed stops
 * waiting, which moves every later root one position up.
 */
function periodsToBackfill(
  count: number,
  failing: ReadonlySet<number>,
  first: number,
): number {
  let waiting = slots(count);
  let periods = 0;
  while (waiting.some((root) => !failing.has(root))) {
    // A rule that starves a root would otherwise never return.
    if (periods > count * count) return Number.POSITIVE_INFINITY;
    const observed = new Set(
      rootTurn(waiting.length, first + periods)
        .map((position) => waiting[position])
        .filter((root) => root !== undefined && !failing.has(root)),
    );
    waiting = waiting.filter((root) => !observed.has(root));
    periods++;
  }
  return periods;
}

test("nothing waiting reads nothing, and a budget or fewer are all tried every period", () => {
  expect(artworkRootBackfillTurn(0, 82_000)).toEqual([]);
  for (const count of [1, 7, ROOT_BUDGET])
    for (let period = 82_000; period < 82_010; period++)
      expect(rootTurn(count, period).toSorted((a, b) => a - b)).toEqual(
        slots(count),
      );
});

test("a root turn never exceeds the period budget or reads a position twice", () => {
  for (const count of [26, 49, 50, 51, 202, 1000])
    for (let period = 82_000; period < 82_100; period++) {
      const turn = rootTurn(count, period);
      expect(turn).toHaveLength(ROOT_BUDGET);
      expect(new Set(turn).size).toBe(ROOT_BUDGET);
      expect(turn.every((slot) => slot >= 0 && slot < count)).toBe(true);
    }
});

test("an unchanged waiting set is covered in ceil(count / budget) consecutive periods, from any period", () => {
  for (const count of [26, 50, 51, 202, 203])
    for (let first = 82_000; first < 82_060; first++) {
      const tried = new Set(
        slots(Math.ceil(count / ROOT_BUDGET), first).flatMap((period) =>
          rootTurn(count, period),
        ),
      );
      expect(tried.size).toBe(count);
    }
});

test("with nothing failing a backfill takes exactly ceil(count / budget) periods", () => {
  for (const count of [46, 156, 202])
    for (let first = 82_000; first < 82_050; first++)
      expect(periodsToBackfill(count, new Set(), first)).toBe(
        Math.ceil(count / ROOT_BUDGET),
      );
});

test("fewer failing roots than the budget slow a backfill by no more than the budget they take", () => {
  const count = 202;
  const failing = new Set(slots(10));
  const bound = Math.ceil(
    (count - failing.size) / (ROOT_BUDGET - failing.size),
  );
  for (let first = 82_000; first < 82_200; first++)
    expect(periodsToBackfill(count, failing, first)).toBeLessThanOrEqual(bound);
});

test("more permanently failing roots than the budget cannot keep the others from being observed", () => {
  const count = 202;
  const layouts = [
    // The failures sort first, last, and spread through the ring.
    new Set(slots(60)),
    new Set(slots(60, count - 60)),
    new Set(slots(60).map((index) => Math.floor((index * count) / 60))),
  ];
  // Every stretch of ceil(count / budget) periods in which nothing changes
  // tries every root, so each such stretch observes at least one more.
  const bound = (count - 60) * Math.ceil(count / ROOT_BUDGET);
  for (const failing of layouts)
    for (let first = 82_000; first < 82_200; first++)
      expect(periodsToBackfill(count, failing, first)).toBeLessThanOrEqual(
        bound,
      );
  // What is left is only the failures, and they are all retried on their turn.
  for (let first = 82_000; first < 82_010; first++) {
    const tried = new Set(
      slots(Math.ceil(60 / ROOT_BUDGET), first).flatMap((period) =>
        rootTurn(60, period),
      ),
    );
    expect(tried.size).toBe(60);
  }
});
