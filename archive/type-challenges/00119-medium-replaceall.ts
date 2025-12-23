// ============= Test Cases =============
import type { Equal, Expect } from "./test-utils";

type cases = [
  Expect<Equal<ReplaceAll<"foobar", "bar", "foo">, "foofoo">>,
  Expect<Equal<ReplaceAll<"foobar", "bag", "foo">, "foobar">>,
  Expect<Equal<ReplaceAll<"foobarbar", "bar", "foo">, "foofoofoo">>,
  Expect<Equal<ReplaceAll<"t y p e s", " ", "">, "types">>,
  Expect<Equal<ReplaceAll<"foobarbar", "", "foo">, "foobarbar">>,
  Expect<Equal<ReplaceAll<"barfoo", "bar", "foo">, "foofoo">>,
  Expect<Equal<ReplaceAll<"foobarfoobar", "ob", "b">, "fobarfobar">>,
  Expect<Equal<ReplaceAll<"foboorfoboar", "bo", "b">, "foborfobar">>,
  Expect<Equal<ReplaceAll<"", "", "">, "">>
];

type a = ReplaceAll<"foobarfoobar", "ob", "b">;

// ============= Your Code Here =============
// type ReplaceAll<
//   S extends string,
//   From extends string,
//   To extends string
// > = From extends ""
//   ? S
//   : S extends `${infer First}${From}${infer Last}`
//   ? ReplaceAll<`${First}${To}${Last}`, From, To>
//   : S;

// second attempt! one-pass
type ReplaceAll<
  S extends string,
  From extends string,
  To extends string
> = From extends ""
  ? S
  : S extends `${infer First}${From}${infer Last}`
  ? `${First}${To}${ReplaceAll<`${Last}`, From, To>}`
  : S;
