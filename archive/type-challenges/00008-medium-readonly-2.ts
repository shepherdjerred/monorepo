// ============= Test Cases =============
import type { Alike, Expect } from './test-utils'

type cases = [
  Expect<Alike<MyReadonly2<Todo1>, Readonly<Todo1>>>,
  Expect<Alike<MyReadonly2<Todo1, 'title' | 'description'>, Expected>>,
  Expect<Alike<MyReadonly2<Todo2, 'title' | 'description'>, Expected>>,
  Expect<Alike<MyReadonly2<Todo2, 'description' >, Expected>>,
]

// @ts-expect-error
type error = MyReadonly2<Todo1, 'title' | 'invalid'>

interface Todo1 {
  title: string
  description?: string
  completed: boolean
}

interface Todo2 {
  readonly title: string
  description?: string
  completed: boolean
}

interface Expected {
  readonly title: string
  readonly description?: string
  completed: boolean
}


// ============= Your Code Here =============
// type MyReadonly2<T, K extends keyof T = keyof T> = {
//   readonly [Key in K]: T[Key];
// } & {
//   [Key in K]: T[Key];
// }
// this doesn't work because `readonly` is not preserved

// ============= Your Code Here =============
type MyReadonly2<T, K extends keyof T = keyof T> = {
  readonly [Key in K]: T[Key];
} & {
  // using a conditional type here preserves the `readonly` type modifier
  [Key in keyof T as Key extends K ? never : Key]: T[Key];
}
