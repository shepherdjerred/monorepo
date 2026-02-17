// ============= Test Cases =============
import type { Equal, Expect } from "./test-utils";

type cases = [
  Expect<Equal<TrimLeft<"str">, "str">>,
  Expect<Equal<TrimLeft<" str">, "str">>,
  Expect<Equal<TrimLeft<"     str">, "str">>,
  Expect<Equal<TrimLeft<"     str     ">, "str     ">>,
  Expect<Equal<TrimLeft<"   \n\t foo bar ">, "foo bar ">>,
  Expect<Equal<TrimLeft<"">, "">>,
  Expect<Equal<TrimLeft<" \n\t">, "">>,
];

type test = TrimLeft<"     str">;

type Whitespace = " " | "\n" | "\t";

// ============= Your Code Here =============
type TrimLeft<S extends string> =
  S extends `${Whitespace}${infer T extends string}` ? TrimLeft<T> : S;
