# Rust safety and implementation patterns

Read this when reviewing unsafe code, ownership/borrowing, text slicing, async joins, cleanup, or assertions.

## Unsafe obligations

Unsafe Rust permits a limited set of operations that can cause undefined behavior if their contracts are violated. Other static checks remain active.

For each unsafe function:

- document caller obligations under `# Safety`,
- keep unsafe operations in explicit blocks,
- explain why each block satisfies pointer validity, initialization, alignment, aliasing, lifetime, and concurrency requirements,
- expose a safe abstraction only when it can uphold the invariant for every safe caller.

Rust 2024's `unsafe_op_in_unsafe_fn` warning makes the explicit-block boundary visible even inside an unsafe function.

## Disjoint mutable access

Multiple mutable references are valid when proven disjoint. Prefer APIs such as slice splitting or stabilized disjoint indexing rather than unsafe pointer arithmetic.

## UTF-8 previews

Rust strings are UTF-8 and ranges use bytes. A safe character-limited preview is:

```rust
fn preview(summary: &str) -> String {
    let prefix: String = summary.chars().take(20).collect();
    format!("{prefix}...")
}
```

Decide whether grapheme clusters rather than Unicode scalar values are the product requirement; `.chars()` can split a user-perceived grapheme.

## Async joins

Joining `JoinHandle`s returns each handle's `Result<Output, JoinError>`. Name and unwrap or propagate both layers accurately; do not label the raw joined values as completed domain objects.

Async closures stabilized in Rust 1.85. They are not restricted to the Rust 2024 edition.

## Cleanup

Check errors from operations whose failure can invalidate results, including writers, trace output, database shutdown, and child-process exit. Drop-based cleanup cannot report an error, so use an explicit close/finish method where the API exposes meaningful failure.

## Assertions

Prefer assertions that show the actual mismatch:

```rust
let value = parse("42")?;
assert_eq!(value, 42);
```

When success itself is the subject, use `expect` with useful context or return `Result` from the test. Avoid `assert!(result.is_ok())` because it hides the error.

## Primary documentation

- [Rust Reference: unsafety](https://doc.rust-lang.org/reference/unsafety.html)
- [Rustonomicon: what unsafe can do](https://doc.rust-lang.org/nomicon/what-unsafe-does.html)
- [The Book: unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html)
- [Rust 2024 unsafe operations](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html)
