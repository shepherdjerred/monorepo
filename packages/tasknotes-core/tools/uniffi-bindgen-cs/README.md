# Pinned C# generator retarget

`tasknotes-core` pins UniFFI 0.32. The current upstream
[`NordSecurity/uniffi-bindgen-cs`](https://github.com/NordSecurity/uniffi-bindgen-cs)
release, `v0.11.0+v0.31.0`, targets UniFFI 0.31 and cannot read 0.32
`cdylib` metadata. Generating through its UDL mode is not a substitute: the
generated C# checksum gate then rejects the 0.32 library.

`cargo xtask generate-bindings` and `cargo xtask check-bindings` therefore
clone the exact upstream commit
`e10ce410eb3a10cc19c7928b93ea8d84e038c034`, decode this directory's minimal
retarget into the temporary clone, replace `Cargo.lock` with the committed
post-retarget resolution, and run `cargo build --locked --package
uniffi-bindgen-cs`. The hex representation preserves the exact unified diff
without weakening the repository's whitespace gate. The resulting binary is
only a generation tool; it is never linked into or shipped with the TaskNotes
core library.

The patch changes only the generator's UniFFI dependency line and the two 0.32
`Type` additions (`Box` and `Set`). The lockfile makes that generator build
reproducible. The upstream source is MPL-2.0, the same license that covers its
patch-derived changes.

Remove this bridge only after all of these pass against a released upstream
generator that targets UniFFI 0.32 or later:

1. `--library` generation from the TaskNotes 0.32 `cdylib` succeeds.
2. The Windows project compiles with the generated binding.
3. The runtime UniFFI checksum gate passes.

Until then, do not downgrade TaskNotes' UniFFI pin, maintain a second `cdylib`,
or hand-edit the generated C# binding.
