# Rust release lifecycle

Read this when upgrading Rust, selecting an edition, evaluating an API stabilization, or interpreting a compiler/tool performance claim.

## Current stable

Rust 1.97.1 is current as of 2026-08-03. Patch releases can contain regression and miscompilation fixes, so record the complete patch version in a reproducible toolchain. Keep `rust-version` at the actual minimum compiler the crate supports.

Rust 2024 was released with Rust 1.85.0. Resolver 3 is its Cargo resolver, with explicit configuration needed for virtual workspaces.

## Research ledger

The following 36 official or project-primary pages were fetched and inspected:

1. [Rust 1.97.1](https://blog.rust-lang.org/releases/1.97.1/)
2. [Rust 1.97.0](https://blog.rust-lang.org/releases/1.97.0/)
3. [Rust 1.96.1](https://blog.rust-lang.org/releases/1.96.1/)
4. [Rust 1.96.0](https://blog.rust-lang.org/releases/1.96.0/)
5. [Rust 1.95.0](https://blog.rust-lang.org/releases/1.95.0/)
6. [Rust 1.94.1](https://blog.rust-lang.org/releases/1.94.1/)
7. [Rust 1.94.0](https://blog.rust-lang.org/releases/1.94.0/)
8. [Rust 1.93.1](https://blog.rust-lang.org/releases/1.93.1/)
9. [Rust 1.93.0](https://blog.rust-lang.org/releases/1.93.0/)
10. [Rust 1.92.0](https://blog.rust-lang.org/releases/1.92.0/)
11. [Rust 1.91.0](https://blog.rust-lang.org/releases/1.91.0/)
12. [Rust 1.90.0](https://blog.rust-lang.org/releases/1.90.0/)
13. [Rust 1.88.0](https://blog.rust-lang.org/releases/1.88.0/)
14. [Rust 1.86.0](https://blog.rust-lang.org/releases/1.86.0/)
15. [Rust 1.85.0 and Rust 2024](https://blog.rust-lang.org/releases/1.85.0/)
16. [Rust 2024 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html)
17. [Rust Reference: unsafety](https://doc.rust-lang.org/reference/unsafety.html)
18. [Rustonomicon: what unsafe can do](https://doc.rust-lang.org/nomicon/what-unsafe-does.html)
19. [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html)
20. [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
21. [Dependency resolution](https://doc.rust-lang.org/cargo/reference/resolver.html)
22. [Rust version](https://doc.rust-lang.org/cargo/reference/rust-version.html)
23. [Future incompatibility reports](https://doc.rust-lang.org/cargo/reference/future-incompat-report.html)
24. [Clippy usage](https://doc.rust-lang.org/clippy/usage.html)
25. [Clippy configuration](https://doc.rust-lang.org/clippy/configuration.html)
26. [rustfmt](https://rust-lang.github.io/rustfmt/)
27. [rustup overrides](https://rust-lang.github.io/rustup/overrides.html)
28. [rustup components](https://rust-lang.github.io/rustup/concepts/components.html)
29. [rustc lint levels](https://doc.rust-lang.org/rustc/lints/levels.html)
30. [Rustdoc documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html)
31. [The Book: unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html)
32. [Advanced edition migrations](https://doc.rust-lang.org/edition-guide/editions/advanced-migrations.html)
33. [Rust 2024 unsafe operations](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html)
34. [cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html)
35. [rustc tests](https://doc.rust-lang.org/rustc/tests/index.html)
36. [Miri README](https://github.com/rust-lang/miri/blob/master/README.md)

## Qualification rules

- Stabilization is version-specific; check the crate's MSRV before using an API.
- Performance, linker, cache, and test-speed figures are workload- and platform-dependent.
- LLD became the default only for specified targets such as `x86_64-unknown-linux-gnu`, not every Rust target.
- Rustfmt, Clippy, rust-analyzer, and Miri component versions and availability do not match rustc numerically.
