# Python testing and concurrency

Read this when writing pytest suites, async tests, task groups, subinterpreters, free-threaded code, or profiling/debugging current Python.

## pytest structure

Yield fixtures are the clearest setup/teardown pattern. Teardown runs in reverse order; design fixtures so partial setup cannot leak a resource.

Parametrize through fixtures, decorators, or collection hooks. Assert exact outcomes rather than only truthiness or object existence.

For new projects, pytest recommends `--import-mode=importlib`. A src layout plus an editable install helps ensure tests import the intended package rather than a working-directory shadow.

## Async tests

pytest-asyncio defaults to strict mode for coexistence with other async-framework plugins. Auto mode is convenient only when asyncio owns the suite.

Use a controlled HTTP server or transport fake. Do not call public example endpoints in unit or integration tests.

## TaskGroup and gather

`TaskGroup` cancels sibling tasks when a non-cancellation exception escapes and reports grouped failures. `gather()` preserves input result ordering but does not cancel siblings simply because one awaitable fails. `return_exceptions=True` converts failures into result values.

Choose from required failure semantics; neither API is a universal replacement for the other.

## Subinterpreters

`concurrent.interpreters` provides isolated interpreter state and separate GILs. Interpreters are not a security boundary, and native extensions can violate isolation assumptions.

## Free threading

Official free-threaded builds are supported in Python 3.14. Extension import may re-enable the GIL. Built-in internal locking is not a future thread-safety contract, and single-thread overhead depends on workload. Protect shared invariants explicitly and test with the actual extension set.

## Debugging

Python 3.14 adds `pdb -p/--pid` attach and `set_trace_async()`. Attaching to a process blocked in I/O may wait until it executes bytecode or receives a signal.

## Primary documentation

- [pytest fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html)
- [pytest parametrization](https://docs.pytest.org/en/stable/how-to/parametrize.html)
- [pytest integration practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html)
- [pytest changelog](https://docs.pytest.org/en/stable/changelog.html)
- [pytest-asyncio concepts](https://pytest-asyncio.readthedocs.io/en/stable/concepts.html)
- [pytest-xdist distribution](https://pytest-xdist.readthedocs.io/en/stable/distribution.html)
- [pytest-cov configuration](https://pytest-cov.readthedocs.io/en/latest/config.html)
- [asyncio tasks](https://docs.python.org/3/library/asyncio-task.html)
- [concurrent interpreters](https://docs.python.org/3/library/concurrent.interpreters.html)
- [Free-threading HOWTO](https://docs.python.org/3/howto/free-threading-python.html)
- [pdb](https://docs.python.org/3/library/pdb.html)
