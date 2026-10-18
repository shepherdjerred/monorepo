# Version catalog

`catalog.json` owns upstream dependency and toolchain versions.
Use `parseVersionCatalog` to validate it and `versionCatalogMap` to resolve
values. PostgreSQL owns selected first-party releases and retained worker
routing. Image reuse reads original qualified artifacts from Delivery; it
does not infer deployment state from this catalog.

`image-registry.json` owns first-party Docker Hub repository names and
visibility. Its JSON Schema is the language-neutral contract; the
`image-registry` export validates that contract and exposes
`firstPartyImage(name)` and `firstPartyImageRepository(name)`. Unknown names
throw before a publisher can create a repository with unintended visibility.
Public compiler products are explicit entries. Application, infrastructure,
and CI images have private visibility.

The homelab Docker Hub OpenTofu stack consumes the same registry manifest.
Adding an image requires a registry entry before provisioning or publishing;
adding a registry entry does not activate a workload or resume a paused
publisher. Historical immutable catalog snapshots remain parseable; the active
catalog contains no first-party deployment image values.

Run checks from the repository root:

```sh
bunx turbo run build typecheck test lint --filter=@shepherdjerred/version-catalog
```
