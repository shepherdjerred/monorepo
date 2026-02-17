// ============= Test Cases =============
import type { Equal, Expect } from "./test-utils";

const foo = (arg1: string, arg2: number): void => {};
const bar = (arg1: boolean, arg2: { a: "A" }): void => {};
const baz = (): void => {};

type cases = [
  Expect<Equal<MyParameters<typeof foo>, [string, number]>>,
  Expect<Equal<MyParameters<typeof bar>, [boolean, { a: "A" }]>>,
  Expect<Equal<MyParameters<typeof baz>, []>>,
];

// ============= Your Code Here =============
type MyParameters<T extends (...args: any[]) => any> = T extends (
  ...args: infer T
) => any
  ? T
  : unknown;
