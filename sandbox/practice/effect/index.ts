import { Effect } from "effect";
import * as fs from "fs";

const divide = (a: number, b: number): Effect.Effect<number, Error, never> =>
  b === 0
    ? Effect.fail(new Error("Cannot divide by zero"))
    : Effect.succeed(a / b);

function grabFromFile(path: string): Effect.Effect<string, Error, never> {
  return Effect.try({
    try: () => fs.readFileSync(path, "utf-8"),
    catch: (error) => {
      return new Error(`Error reading file: ${error}`);
    },
  });
}

function doingTwoThings(): Effect.Effect<unknown, Error, never> {
  const result = divide(4, 2);
  const fileContent = grabFromFile("example.txt");

  // OK, but what if fileContent or divide fail?

  // at this point we essentially just have
  // an effect with iirc will be a Monad
  // so we are doing computation in a wrapper
  // we would need to perform the console log also in an effect
  console.log(`${result}, ${fileContent}`);
}

Effect.runSync(divide(4, 2)); // => 2
