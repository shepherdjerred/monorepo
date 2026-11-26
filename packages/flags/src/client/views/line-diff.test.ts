import { expect, test } from "vitest";
import { sideBySide } from "./line-diff.ts";

const text = (lines: readonly string[]): string => lines.join("\n");

function render(left: string, right: string): string[] {
  return sideBySide(left, right).map((row) => {
    const side = (cell: (typeof row)["left"], mark: string): string =>
      cell === undefined
        ? "·"
        : `${cell.changed ? mark : " "}${String(cell.number)}:${cell.text}`;
    return `${side(row.left, "-")} | ${side(row.right, "+")}`;
  });
}

test("identical texts share every row", () => {
  expect(render(text(["a", "b"]), text(["a", "b"]))).toEqual([
    " 1:a |  1:a",
    " 2:b |  2:b",
  ]);
});

test("a changed line pairs the removed line with the added one", () => {
  expect(
    render(
      text(["{", '  "default": false', "}"]),
      text(["{", '  "default": true', "}"]),
    ),
  ).toEqual([
    " 1:{ |  1:{",
    '-2:  "default": false | +2:  "default": true',
    " 3:} |  3:}",
  ]);
});

test("insertions and deletions leave gaps opposite them", () => {
  expect(render(text(["a", "b", "c"]), text(["a", "c", "d", "e"]))).toEqual([
    " 1:a |  1:a",
    "-2:b | ·",
    " 3:c |  2:c",
    "· | +3:d",
    "· | +4:e",
  ]);
});

test("an absent side is all gaps", () => {
  expect(render("", text(["x", "y"]))).toEqual(["· | +1:x", "· | +2:y"]);
  expect(render(text(["x"]), "")).toEqual(["-1:x | ·"]);
  expect(render("", "")).toEqual([]);
});
