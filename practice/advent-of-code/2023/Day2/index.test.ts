import { expect, test } from "bun:test";
import { solvePartOne, solvePartTwo } from ".";

test("part one example", async () => {
  expect(await solvePartOne("in.part1.example.txt")).toEqual(8);
});

test("part one", async () => {
  expect(await solvePartOne("in.part1.txt")).toMatchSnapshot();
});

// Part two uses the same input as part one
test("part two example", async () => {
  expect(await solvePartTwo("in.part1.example.txt")).toEqual(2286);
});

test("part two", async () => {
  expect(await solvePartTwo("in.part1.txt")).toMatchSnapshot();
});
