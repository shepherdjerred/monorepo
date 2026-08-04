# Bun mocks and type tests

Read this when using function mocks, spies, module mocks, fake timers, extended matchers, or `expectTypeOf`.

## Function mocks

Type the parameters and return value according to the dependency contract. A zero-argument mock should not be called with arguments merely because runtime JavaScript permits it.

## Spies and restoration

Clear history, reset implementations, and restore spies are distinct operations. Put restoration in `afterEach` unless the suite intentionally shares state.

## Module mocks

Module overrides are not restored by ordinary mock restoration. Default single-process execution makes that visible across files; isolation changes the boundary but not the need for deliberate design.

Register complete module mocks before first import. A partial mock that imports the real module has already executed module initialization.

## Type assertions

`expectTypeOf` exists for type-level relationships but emits no runtime validation. Keep its files in the TypeScript project and run the compiler/typecheck task.

## Primary documentation

- [Mocks](https://bun.com/docs/test/mocks)
- [Mock clock](https://bun.com/docs/guides/test/mock-clock)
- [Mock functions](https://bun.com/docs/guides/test/mock-functions)
- [Spy on](https://bun.com/docs/guides/test/spy-on)
- [Concurrent tests](https://bun.com/reference/bun/test/Test/concurrent)
- [Serial tests](https://bun.com/reference/bun/test/Test/serial)
- [Expected failures](https://bun.com/reference/bun/test/Test/failing)
- [onTestFinished](https://bun.com/reference/bun/test/onTestFinished)
- [expectTypeOf](https://bun.com/reference/bun/test/expectTypeOf)
- [mock](https://bun.com/reference/bun/test/mock)
- [spyOn](https://bun.com/reference/bun/test/spyOn)
- [vi compatibility](https://bun.com/reference/bun/test/vi)
- [toBePositive](https://bun.com/reference/bun/test/Matchers/toBePositive)
- [toContainAllKeys](https://bun.com/reference/bun/test/Matchers/toContainAllKeys)
- [toInclude](https://bun.com/reference/bun/test/Matchers/toInclude)
- [toSatisfy](https://bun.com/reference/bun/test/Matchers/toSatisfy)
