// Money and date parsing shared by document sources.

// Matches 1,234.56 / $1,234.56 / (1,234.56) / 1,234.56-
const MONEY_PATTERN = /\(?-?\$?\s*([\d,]+\.\d{2})\)?(-)?/;

export function parseMoney(raw: string): number | undefined {
  const match = MONEY_PATTERN.exec(raw.trim());
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value)) return undefined;
  const negative =
    raw.includes("(") || raw.trimStart().startsWith("-") || match[2] === "-";
  return negative ? -value : value;
}

// Every money value on a line, in order. Statement rows are positional
// ("Current <hours> <gross> <pretax> <taxes> <posttax> <net>"), so ordered
// extraction is more robust than trying to align against printed headers.
export function parseMoneyRow(line: string): number[] {
  const values: number[] = [];
  for (const match of line.matchAll(/\(?-?\$?\s*[\d,]+\.\d{2}\)?-?/g)) {
    const value = parseMoney(match[0]);
    if (value !== undefined) values.push(value);
  }
  return values;
}

export type MoneyCell = { x: number; width: number; str: string };

// Money is printed with cents; a bare integer is an hours or rate column.
function isMoneyCell(cell: MoneyCell): boolean {
  return /^\(?-?\$?[\d,]+\.\d{2}\)?-?$/.test(cell.str.trim());
}

// The first money value on a row, and where it ends.
//
// A statement's total row is the reliable way to locate a column: it always
// prints the current-period figure first, so its right edge says where that
// column lies on this particular page.
export function firstMoneyCell(cells: MoneyCell[]): MoneyCell | undefined {
  return [...cells].sort((a, b) => a.x - b.x).find((c) => isMoneyCell(c));
}

export function cellRight(cell: MoneyCell): number {
  return cell.x + cell.width;
}

// Tables are laid out so adjacent money columns are much further apart than
// this, and right-aligned values in one column end within a point or two of
// each other.
const COLUMN_TOLERANCE = 10;

// The money value belonging to the column that ends at `right`.
//
// A table cell that is empty prints nothing at all, so "the first amount on
// this row" is not "this row's current-period amount" — on a row whose
// current cell is blank it is the year-to-date figure from the next column
// over, and only position distinguishes them. Values are right-aligned, so
// the column is identified by where its values end rather than where the
// longest one happens to start.
export function moneyAtColumn(
  cells: MoneyCell[],
  right: number,
): number | undefined {
  for (const cell of cells) {
    if (!isMoneyCell(cell)) continue;
    if (Math.abs(cellRight(cell) - right) > COLUMN_TOLERANCE) continue;
    return parseMoney(cell.str);
  }
  return undefined;
}

// MM/DD/YYYY as printed on US statements.
export function parseUsDate(raw: string): string | undefined {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  return match === null
    ? undefined
    : `${match[3] ?? ""}-${match[1] ?? ""}-${match[2] ?? ""}`;
}
