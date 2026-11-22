import {
  shiftDays,
  shiftMonthOfDate,
  weekEnds,
  type CivilDate,
} from "./dates.ts";

/**
 * Where a key takes the reader from one day of the month grid: an arrow to
 * the neighbouring day or the same weekday a week away, Home and End to the
 * ends of the week, Page Up and Page Down to the same day a month away. Null
 * for any other key, which the grid leaves to the browser.
 *
 * The move is date arithmetic, not a search of the squares on screen, so it
 * carries on into the next month where the grid ends.
 */
export function keyDestination(key: string, from: CivilDate): CivilDate | null {
  switch (key) {
    case "ArrowLeft": {
      return shiftDays(from, -1);
    }
    case "ArrowRight": {
      return shiftDays(from, 1);
    }
    case "ArrowUp": {
      return shiftDays(from, -7);
    }
    case "ArrowDown": {
      return shiftDays(from, 7);
    }
    case "Home": {
      return weekEnds(from).start;
    }
    case "End": {
      return weekEnds(from).end;
    }
    case "PageUp": {
      return shiftMonthOfDate(from, -1);
    }
    case "PageDown": {
      return shiftMonthOfDate(from, 1);
    }
    default: {
      return null;
    }
  }
}
