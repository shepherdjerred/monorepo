import assert from "assert";
import { _cache } from "module";
import * as R from "remeda";

type Game = {
  id: number;
  rounds: Round[];
};

type Round = {
  red: number;
  blue: number;
  green: number;
};

type ColorCount = { red: number; blue: number; green: number };

export async function solvePartOne(file: string): Promise<number> {
  const contents = await Bun.file(file).text();
  const lines = contents.split("\n");
  const games: Game[] = R.pipe(
    lines,
    R.dropLast(1),
    R.map((line): Game => {
      const [game, cubes] = line.split(": ");
      const [_, id] = game.split(" ");

      const roundsStrings = cubes.split("; ");
      const rounds = R.map(roundsStrings, (roundString): Round => {
        const cubesStrings = roundString.split(", ");

        const cubes: Partial<ColorCount>[] = R.map(
          cubesStrings,
          (cubeString) => {
            const [count, color] = cubeString.split(" ");

            assert(
              ["red", "blue", "green"].includes(color),
              `Invalid color: ${color}`
            );

            return { [color]: Number(count) };
          }
        );

        const merged: Partial<ColorCount> = R.mergeAll(cubes);

        return {
          red: merged.red || 0,
          blue: merged.blue || 0,
          green: merged.green || 0,
        };
      });

      return {
        id: Number(id),
        rounds: rounds,
      };
    })
  );

  const possible = R.pipe(
    games,
    R.reject((game) => {
      return (
        R.find(game.rounds, (round: Round): boolean => {
          return round.red > 12 || round.blue > 14 || round.green > 13;
        }) !== undefined
      );
    })
  );

  return R.pipe(
    possible,
    R.map((game) => game.id),
    R.sumBy(R.identity)
  );
}

export async function solvePartTwo(file: string): Promise<number> {
  const contents = await Bun.file(file).text();
  const lines = contents.split("\n");
  const games: Game[] = R.pipe(
    lines,
    R.dropLast(1),
    R.map((line): Game => {
      const [game, cubes] = line.split(": ");
      const [_, id] = game.split(" ");

      const roundsStrings = cubes.split("; ");
      const rounds = R.map(roundsStrings, (roundString): Round => {
        const cubesStrings = roundString.split(", ");

        const cubes: Partial<ColorCount>[] = R.map(
          cubesStrings,
          (cubeString) => {
            const [count, color] = cubeString.split(" ");

            assert(
              ["red", "blue", "green"].includes(color),
              `Invalid color: ${color}`
            );

            return { [color]: Number(count) };
          }
        );

        const merged: Partial<ColorCount> = R.mergeAll(cubes);

        return {
          red: merged.red || 0,
          blue: merged.blue || 0,
          green: merged.green || 0,
        };
      });

      return {
        id: Number(id),
        rounds: rounds,
      };
    })
  );

  const minimum = R.pipe(
    games,
    R.map((game) => {
      return R.reduce(
        game.rounds,
        (acc, round) => {
          return {
            red: Math.max(acc.red, round.red),
            blue: Math.max(acc.blue, round.blue),
            green: Math.max(acc.green, round.green),
          };
        },
        { red: 0, blue: 0, green: 0 }
      );
    })
  );

  return R.pipe(
    minimum,
    R.map((min) => {
      return min.red * min.blue * min.green;
    }),
    R.sumBy(R.identity)
  );
}
