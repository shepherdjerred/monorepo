// Ambient types for the `bun:test` runner, scoped to the matchers this suite
// uses. Declared locally (rather than pulling in `bun-types`/`@types/bun`) so
// Bun's global DOM types — notably its `fetch`/`AbortSignal` overloads — do not
// leak into the React Native source build, where they conflict with the RN
// runtime types. Tests execute under `bun test`; the runtime provides the real
// implementations.
declare module "bun:test" {
  type Matchers<T> = {
    toBe: (expected: T) => void;
    toEqual: (expected: T) => void;
    toStrictEqual: (expected: T) => void;
    toHaveLength: (length: number) => void;
    toContain: (item: unknown) => void;
    toMatch: (pattern: string | RegExp) => void;
    toBeGreaterThan: (n: number | bigint) => void;
    toBeGreaterThanOrEqual: (n: number | bigint) => void;
    toBeLessThan: (n: number | bigint) => void;
    toBeLessThanOrEqual: (n: number | bigint) => void;
    toBeNull: () => void;
    toBeUndefined: () => void;
    toBeDefined: () => void;
    toBeInstanceOf: (constructor: new (...args: never[]) => unknown) => void;
    toThrow: (message?: string | RegExp | Error) => void;
    readonly not: Matchers<T>;
    readonly resolves: AsyncMatchers<Awaited<T>>;
    readonly rejects: AsyncMatchers<unknown>;
  };

  type AsyncMatchers<T> = {
    toBe: (expected: T) => Promise<void>;
    toEqual: (expected: T) => Promise<void>;
    toThrow: (message?: string | RegExp | Error) => Promise<void>;
    readonly not: AsyncMatchers<T>;
  };

  export function expect<T>(actual: T): Matchers<T>;

  type TestFn = () => void | Promise<void>;

  export function describe(label: string, fn: () => void): void;
  export function test(label: string, fn: TestFn, timeout?: number): void;
  export function it(label: string, fn: TestFn, timeout?: number): void;

  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
  export function beforeAll(fn: TestFn): void;
  export function afterAll(fn: TestFn): void;
}
