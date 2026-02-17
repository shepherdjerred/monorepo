import { expect, test } from "bun:test";
import { solvePartOne, solvePartTwo } from ".";

test("part one example", async () => {
  expect(await solvePartOne("in.part1.example.txt")).toEqual(142);
});

test("part one", async () => {
  expect(await solvePartOne("in.part1.txt")).toMatchSnapshot();
});

test("part two example", async () => {
  expect(await solvePartTwo("in.part2.example.txt")).toEqual(281);
});

test("part two", async () => {
  expect(await solvePartTwo("in.part2.txt")).toMatchSnapshot();
});
