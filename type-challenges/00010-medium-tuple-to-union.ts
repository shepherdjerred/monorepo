// ============= Test Cases =============
import type { Equal, Expect } from './test-utils'

type cases = [
  Expect<Equal<TupleToUnion<[123, '456', true]>, 123 | '456' | true>>,
  Expect<Equal<TupleToUnion<[123]>, 123>>,
]

type thing = TupleToUnion<[123, '456', true]>;

// ============= Your Code Here =============
type TupleToUnion<T> = T extends [infer First, ...infer Rest] ? First | TupleToUnion<Rest> : never;
