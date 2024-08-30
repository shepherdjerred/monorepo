import assert from "assert";
import { _cache } from "module";
import * as R from "remeda";

export async function solvePartOne(file: string): Promise<number> {
  const contents = await Bun.file(file).text();
  const lines = contents.split("\n");
  return R.pipe(
    lines,
    R.dropLast(1),
    R.map(R.reject(isNaN)),
    R.map(R.map(Number)),
    R.map((nums) => {
      console.log(nums);
      const first = R.first(nums);
      const last = R.last(nums);
      assert(first !== undefined, `${nums} has no first`);
      assert(last !== undefined, `${nums} has no last`);
      return first * 10 + last;
    }),
    R.sumBy(R.identity)
  );
}

export async function solvePartTwo(file: string): Promise<number> {
  const contents = await Bun.file(file).text();
  const lines = contents.split("\n");
  return R.pipe(
    lines,
    R.dropLast(1),
    R.map((line) => {
      const numbersAsWord = [
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
      ];

      const map = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
      };

      let nums = [];
      let temp = line;

      while (temp.length > 0) {
        if (!isNaN(Number(temp[0]))) {
          nums.push(Number(temp[0]));
        } else {
          const match = R.find(numbersAsWord, (c) => temp.startsWith(c));
          if (match) {
            nums.push(map[match]);
          }
        }
        temp = temp.slice(1);
      }

      // create a joined string for every possible length
      // check if the start of the string is a valid word, or a number
      // if so, push onto new array

      return nums;
    }),
    R.map((nums) => {
      console.log(nums);
      const first = R.first(nums);
      const last = R.last(nums);
      assert(first !== undefined, `${nums} has no first`);
      assert(last !== undefined, `${nums} has no last`);
      return first * 10 + last;
    }),
    R.sumBy(R.identity)
  );
}
