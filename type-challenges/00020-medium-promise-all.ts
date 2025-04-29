// ============= Test Cases =============
import type { Equal, Expect } from "./test-utils";

const promiseAllTest1 = PromiseAll([1, 2, 3] as const);
const promiseAllTest2 = PromiseAll([1, 2, Promise.resolve(3)] as const);
const promiseAllTest3 = PromiseAll([1, 2, Promise.resolve(3)]);
const promiseAllTest4 = PromiseAll<Array<number | Promise<number>>>([1, 2, 3]);

type cases = [
  Expect<Equal<typeof promiseAllTest1, Promise<[1, 2, 3]>>>,
  Expect<Equal<typeof promiseAllTest2, Promise<[1, 2, number]>>>,
  Expect<Equal<typeof promiseAllTest3, Promise<[number, number, number]>>>,
  Expect<Equal<typeof promiseAllTest4, Promise<number[]>>>
];

// ============= Your Code Here =============
declare function PromiseAll<T extends (Promise<unknown> | number)[]>(
  values: T
): Promise<PromiseAllType<T>>;

type PromiseAllType<T extends (Promise<unknown> | number)[]> = T extends [
  infer Head,
  ...infer Tail
]
  ? Tail extends (Promise<unknown> | number)[]
    ? [Head extends Promise<unknown> ? Awaited<Head> : Head, ...PromiseAllType<Tail>]
    : []
  : [];
