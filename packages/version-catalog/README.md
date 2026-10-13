# Version catalog

`catalog.json` owns dependency versions and internal image release pins.
Use `parseVersionCatalog` to validate it and `versionCatalogMap` to resolve
values. `internal-image-pins` verifies changes that only advance unmanaged
internal image pins.

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
publisher. Version-catalog release channels continue to identify pins within
one repository rather than additional Docker Hub repositories.

Run checks from the repository root:

```sh
bunx turbo run build typecheck test lint --filter=@shepherdjerred/version-catalog
```
