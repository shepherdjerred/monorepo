# Bun DOM and integration tests

Read this when configuring Happy DOM, Testing Library, jest-dom, databases, HTTP servers, or other integration resources.

## DOM environment

Bun documents Happy DOM through a preload/global registrator. Keep environment setup explicit and scoped to tests that require DOM behavior.

## jest-dom setup

Bun's general DOM page and dedicated Testing Library guide differ. Prefer the dedicated guide's explicit matcher extension and TypeScript declaration merging so runtime and matcher types agree.

## Interactions

Testing Library recommends interactions resembling user behavior. `user-event@14` uses async operations and models more browser interaction. `fireEvent` dispatches a low-level synchronous event.

## Cleanup

Testing Library cleanup integrates with common lifecycle hooks, but custom global registrators, timers, servers, and module state still need explicit ownership.

## Databases

Before destructive cleanup, parse and validate that the connection targets a dedicated ephemeral test database/schema. Prefer transactional rollback or unique records. An unrestricted ORM delete against an arbitrary environment URL is unsafe.

## Servers

`Bun.Server.stop()` returns `Promise<void>`. Await graceful stop, or pass forced stop only when the test contract requires immediate active-connection closure.

## Primary documentation

- [Bun DOM testing](https://bun.com/docs/test/dom)
- [Happy DOM guide](https://bun.com/docs/guides/test/happy-dom)
- [Testing Library guide](https://bun.com/docs/guides/test/testing-library)
- [Svelte testing guide](https://bun.com/docs/guides/test/svelte-test)
- [DOM Testing Library](https://testing-library.com/docs/dom-testing-library/intro/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [fireEvent](https://testing-library.com/docs/dom-testing-library/api-events/)
- [user-event](https://testing-library.com/docs/user-event/intro/)
- [Cleanup](https://testing-library.com/docs/react-testing-library/api/#cleanup)
- [jest-dom](https://github.com/testing-library/jest-dom)
- [Happy DOM](https://github.com/capricorn86/happy-dom)
- [Happy DOM global registrator](https://github.com/capricorn86/happy-dom/tree/master/packages/@happy-dom/global-registrator)
- [Server stop](https://bun.com/reference/bun/Server/stop)
