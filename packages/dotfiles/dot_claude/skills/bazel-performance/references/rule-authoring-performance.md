# Rule Authoring for Performance

Deep-dive on writing performant Starlark rules. The patterns here can make the difference between O(N) and O(N^2) build times.

---

## Depsets: The #1 Performance Pattern

Depsets use a DAG structure that shares data across the dependency graph. Each target adds its own contents without reading or copying predecessors.

Lists cause O(N^2) duplication -- each item gets copied at every level of the dependency tree.

### Anti-Patterns

```python
# BAD: Converting depset to list prematurely -- O(N^2)
# Every intermediate rule copies and concatenates ALL transitive files
all_files = depset(...).to_list() + ctx.files.srcs

# BAD: Nesting depset() in a loop -- creates deeply nested, slow depsets
x = depset()
for i in inputs:
    x = depset(transitive=[x, i.deps])

# BAD: Calling to_list() in an intermediate rule
# If 1000 rules each call to_list(), you get 1000 * N copies = O(N^2)
def _my_library_impl(ctx):
    all_srcs = []
    for dep in ctx.attr.deps:
        all_srcs.extend(dep[MyInfo].srcs.to_list())  # DON'T DO THIS
    all_srcs.extend(ctx.files.srcs)
    return [MyInfo(srcs=depset(all_srcs))]
```

### Correct Patterns

```python
# GOOD: Collect all transitives, merge once
x = depset(
    direct=ctx.files.srcs,
    transitive=[dep[MyInfo].files for dep in ctx.attr.deps],
)

# GOOD: Only call to_list() in terminal rules (binary, test)
def _my_binary_impl(ctx):
    all_srcs = ctx.attr.lib[MyInfo].srcs  # This is a depset
    # to_list() is OK here because this is a terminal rule -- O(N) total
    for src in all_srcs.to_list():
        # ... process each source
        pass

# GOOD: Pass depsets directly without materializing
def _my_library_impl(ctx):
    return [MyInfo(
        srcs=depset(
            direct=ctx.files.srcs,
            transitive=[dep[MyInfo].srcs for dep in ctx.attr.deps],
        ),
    )]
```

### When to_list() is Acceptable

- Terminal rules (binaries, test rules) where flattening cost is O(N) total
- Debugging and inspection
- Even in terminal rules, be cautious: overlapping deps (test suites, IDE imports) can still cause quadratic costs

---

## ctx.actions.args() for Deferred Expansion

`ctx.actions.args()` defers depset expansion to the execution phase, avoiding memory allocation during analysis. This can reduce memory by 90%+ for large dependency trees.

### Pattern

```python
def _my_rule_impl(ctx):
    args = ctx.actions.args()

    # Pass depsets directly -- expanded only at execution time
    args.add_all(ctx.attr.dep[MyInfo].headers, format_each="-I%s")

    # Use map_each for transformations
    args.add_all(ctx.files.srcs, map_each=_to_short_path)

    # Handle oversized command lines automatically
    args.use_param_file("@%s")

    # Pass File objects directly -- auto-converted to paths
    args.add(ctx.file.config)

    ctx.actions.run(
        executable=ctx.executable._tool,
        arguments=[args],
        inputs=depset(
            direct=ctx.files.srcs,
            transitive=[ctx.attr.dep[MyInfo].headers],
        ),
    )
```

### Key Rules

- Pass depsets directly to `args.add_all()` -- never convert to lists first
- Use `format_each` and `map_each` parameters instead of string concatenation
- Use `use_param_file` for commands that might exceed shell limits
- Use constants for string arguments to share memory across instances

---

## Minimal Input Declaration

Declare only the inputs an action actually needs. Extra inputs increase:

- File stat overhead (Bazel checks each input for changes)
- Sandbox setup cost (each input gets symlinked)
- Remote cache upload size
- Merkle tree computation time

```python
# BAD: Including all transitive sources when only direct are needed
ctx.actions.run(
    inputs=ctx.attr.dep[MyInfo].transitive_srcs,  # Overkill
    ...
)

# GOOD: Only include what the action reads
ctx.actions.run(
    inputs=depset(
        direct=ctx.files.srcs + [ctx.file.config],
        transitive=[ctx.attr.dep[MyInfo].headers],  # Only headers, not all sources
    ),
    ...
)
```

---

## Validation Output Groups

Put validation (lint, type-check) in the `_validation` output group so it runs in parallel with the build but off the critical path.

```python
def _my_rule_impl(ctx):
    # Main build output (on critical path)
    output = ctx.actions.declare_file(ctx.label.name + ".out")
    ctx.actions.run(...)

    # Validation output (off critical path, runs in parallel)
    validation = ctx.actions.declare_file(ctx.label.name + ".validation")
    ctx.actions.run(
        outputs=[validation],
        inputs=ctx.files.srcs,
        executable=ctx.executable._validator,
        ...
    )

    return [
        DefaultInfo(files=depset([output])),
        OutputGroupInfo(_validation=depset([validation])),
    ]
```

Validation outputs are always requested regardless of `--output_groups` settings.

---

## Configuration Transitions

Minimize user-defined configuration transitions. Each transition:

- Creates a new copy of the configured target graph for that subtree
- Increases memory usage
- Makes the build graph larger and harder to debug

If you need a transition, prefer 1:1 transitions over 1:2+ splits.

---

## Toolchain Registration

Split toolchain repos into definition and implementation:

- **Definition repo**: Contains only the toolchain target (always fetched during analysis)
- **Implementation repo**: Contains the actual tools (deferred until needed)

This reduces analysis-phase I/O and network fetches, because Bazel only needs to download the toolchain definitions to figure out which toolchain to use.

---

## Analysis Phase Efficiency

- Implementation functions run during analysis and **cannot** read/write files directly
- All file processing must happen through declared actions in the execution phase
- Use `ctx.actions.expand_template()` over building large strings -- more memory efficient
- Minimize computation during analysis; defer work to execution
- Use private attributes (prefixed `_`) for implicit dependencies

---

## Provider Design

```python
# GOOD: Use depsets in providers for transitive data
MyInfo = provider(fields={
    "srcs": "depset of source files",
    "transitive_srcs": "depset of all transitive sources",
    "headers": "depset of header files",
})

# BAD: Using lists in providers
MyInfo = provider(fields={
    "srcs": "list of source files",  # This will cause O(N^2) downstream
})
```
