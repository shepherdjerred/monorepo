# Testing Starlark Rules

Comprehensive guide to testing custom Bazel rules at every level — unit tests for utility functions, analysis tests for rule behavior, integration tests for end-to-end correctness, and documentation testing.

---

## Unit Tests (Pure Functions)

Test Starlark utility functions using `unittest.make()` from `bazel-skylib`:

```python
load("@bazel_skylib//lib:unittest.bzl", "asserts", "unittest")
load(":myhelpers.bzl", "myhelper")

def _myhelper_test_impl(ctx):
    env = unittest.begin(ctx)
    asserts.equals(env, "abc", myhelper())
    return unittest.end(env)

myhelper_test = unittest.make(_myhelper_test_impl)

def myhelpers_test_suite(name):
    unittest.suite(name, myhelper_test)
```

BUILD file:

```python
load(":myhelpers_test.bzl", "myhelpers_test_suite")
myhelpers_test_suite(name = "myhelpers_tests")
```

**Real example from `rules_go`** — testing `has_shared_lib_extension`:

```python
def _versioned_shared_libraries_test(ctx):
    env = unittest.begin(ctx)
    asserts.true(env, has_shared_lib_extension("somelibrary.so"))
    asserts.true(env, has_shared_lib_extension("somelibrary.so.2"))
    asserts.false(env, has_shared_lib_extension("somelibrary.so.e"))
    asserts.false(env, has_shared_lib_extension("xx.1"))
    return unittest.end(env)

versioned_shared_libraries_test = unittest.make(_versioned_shared_libraries_test)
```

---

## Analysis Tests (Rule Behavior)

Test that rules produce correct providers, outputs, and errors without actually building. Two frameworks available:

### Skylib `analysistest`

```python
load("@bazel_skylib//lib:unittest.bzl", "analysistest", "asserts")

def _types_test_impl(ctx):
    env = analysistest.begin(ctx)
    target = analysistest.target_under_test(env)
    types = target[JsInfo].types.to_list()
    asserts.equals(env, 2, len(types))
    asserts.true(env, types[0].path.find("/importing.d.ts") != -1)
    return analysistest.end(env)

_types_test = analysistest.make(_types_test_impl)
```

From `rules_js` — tests that `js_library` correctly populates `JsInfo` provider.

### rules_testing `analysis_test` (Recommended)

Cleaner API with Truth-style fluent assertions:

```python
load("@rules_testing//lib:analysis_test.bzl", "test_suite", "analysis_test")
load("@rules_testing//lib:util.bzl", "util")

def _test_hello(name):
    util.helper_target(native.filegroup, name = name + "_subject", srcs = ["hello.txt"])
    analysis_test(name = name, impl = _test_hello_impl, target = name + "_subject")

def _test_hello_impl(env, target):
    env.expect.that_target(target).default_outputs().contains("hello.txt")

def my_test_suite(name):
    test_suite(name = name, tests = [_test_hello])
```

Advantages: `test_suite` handles instantiation, `util.helper_target` auto-tags `manual`, source files don't need to exist (analysis only records paths), supports config overrides.

Install: `bazel_dep(name = "rules_testing", version = "<VERSION>", dev_dependency = True)`

---

## Failure Tests

Test that rules fail with expected error messages:

```python
def _providers_test_impl(ctx):
    env = analysistest.begin(ctx)
    asserts.expect_failure(env, "does not have mandatory providers")
    return analysistest.end(env)

providers_test = analysistest.make(
    _providers_test_impl,
    expect_failure = True,
)
```

From `rules_go` — tests that using `go_binary` as a dep correctly fails.

Setup: tag the intentionally-broken target `manual`:

```python
go_library(
    name = "lib_binary_deps",
    deps = [":go_binary"],
    tags = ["manual"],
)

providers_test(
    name = "go_binary_deps_test",
    target_under_test = ":lib_binary_deps",
)
```

### Config Overrides in Analysis Tests

```python
my_test = analysistest.make(
    _impl,
    config_settings = {"//command_line_option:compilation_mode": "opt"},
)
```

Limitation: max 500 transitive dependencies (controlled by `--analysis_testing_deps_limit`).

---

## Integration Tests

### `rules_bazel_integration_test`

Create isolated Bazel workspaces and run Bazel inside them:

```python
bazel_dep(name = "rules_bazel_integration_test", version = "0.37.1", dev_dependency = True)
```

Creates child workspace directories, invokes `bazel build` / `bazel test`, verifies results. Essential for testing repository rules and module extensions.

### `go_bazel_test` Pattern (rules_go)

Go-based integration tests that create temporary workspaces:

```python
def go_bazel_test(rule_files = None, **kwargs):
    kwargs.setdefault("tags", [])
    if "local" not in kwargs["tags"]:
        kwargs["tags"].append("local")
    if "exclusive" not in kwargs["tags"]:
        kwargs["tags"].append("exclusive")
    go_test(**kwargs)
```

Tags `local` and `exclusive` prevent sandbox/remote execution and ensure sequential runs.

### Shell-Based Artifact Validation

```python
sh_test(
    name = "validate_output",
    srcs = ["validator.sh"],
    args = ["$(location :mytarget.out)"],
    data = [":mytarget.out"],
)
```

---

## Documentation Testing with Stardoc

Generate and verify documentation from `.bzl` files:

```python
load("@stardoc//stardoc:stardoc.bzl", "stardoc")

stardoc(
    name = "my-docs",
    input = "my_rules.bzl",
    out = "my_rules_doc.md",
    deps = [":my_bzl_library"],
)
```

Use `stardoc_with_diff_test` to check generated docs match committed files:

1. `stardoc` generates fresh docs
2. `diff_test` compares against committed `.md` file
3. An `update_docs` target regenerates when they drift

Workflow: `bazel build //docs/... && bazel test //docs/... && bazel run //docs:update`

---

## Test Organization

Recommended file structure:

```
my_rules/
  lib/
    my_rule.bzl
  tests/
    my_rule/
      BUILD
      my_rule_tests.bzl        # analysis tests
    starlark/
      BUILD
      helper_tests.bzl          # unit tests for utilities
    integration/
      BUILD
      test_workspace/           # child workspace for integration tests
```

**Naming conventions:**

- Test macro: `_test_foo` (private name so buildifier detects missing tests)
- Rule type: `foo_test`
- Impl: `_foo_test_impl`
- Subject targets: prefixed with `foo_`

**Key rules:**

- Always tag subject targets `manual` to prevent `//...` from building broken targets
- Source files don't need to exist for analysis tests
- Use `test_suite` to bundle tests and reduce BUILD boilerplate

---

## Decision Table

| What to Test                   | Framework                                            | Key Function                                   |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------- |
| Pure utility functions         | Skylib `unittest`                                    | `unittest.make()`, `unittest.suite()`          |
| Rule providers & actions       | `rules_testing` (preferred) or Skylib `analysistest` | `analysis_test()`, `analysistest.make()`       |
| Rule failure behavior          | Skylib `analysistest`                                | `analysistest.make(impl, expect_failure=True)` |
| Rule output correctness        | `sh_test` / custom test rule                         | Script validates artifacts                     |
| Repo rules / module extensions | `rules_bazel_integration_test`                       | Child workspace + recursive Bazel              |
| Documentation accuracy         | Stardoc + `diff_test`                                | `stardoc_with_diff_test`                       |
| Macros                         | Analysis tests on produced targets                   | Test the targets the macro creates             |
