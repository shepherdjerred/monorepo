# Docker Hub repository management

This stack owns first-party repositories in the personal `shepherdjerred`
Docker Hub namespace. It reads names and visibility from
`packages/version-catalog/src/image-registry.json`. Existing unrelated Docker
Hub repositories are outside the stack. Repository deletion is protected by
`prevent_destroy`.

The pinned `docker/docker` provider manages Docker Hub, without connecting to
a local Docker daemon. The stack wrapper maps `DOCKERHUB_USERNAME` and
`DOCKERHUB_MANAGEMENT_TOKEN` to the provider's credential environment. The
management PAT needs Read, Write, and Delete permission and belongs only to
this infrastructure boundary. Publishing and deployment use different PATs.
The operator-only `dockerhub-tokens` stack creates these PATs through account
authentication; this repository stack never receives that account login.
Provider credentials are supplied through the existing 1Password wrapper,
never Terraform variables or tracked files.

The state backend uses the existing SeaweedFS state bucket with a dedicated
`dockerhub/terraform.tfstate` key. State and saved plans require the stack's
`TOFU_STATE_ENCRYPTION_PASSPHRASE` from their first write.

Read-only validation needs no live credentials:

```sh
bun packages/homelab/scripts/tofu/tofu-stack.ts dockerhub validate
```

Use the repository stack wrapper for authenticated plans and applies. Inspect
the exact plan before applying. If a declared repository already exists,
adopt it through a declarative import block after verifying its namespace and
visibility; never delete and recreate it. Registry ownership does not change
application release pins, activate workloads, or delete GHCR packages.
