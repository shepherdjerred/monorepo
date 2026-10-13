# Docker Hub automation tokens

This operator-only stack creates the management, publishing, deployment-read,
and Renovate-read personal access tokens through Docker's official
`docker_access_token` resource. It uses a separate encrypted state from the
repository-management stack so CI never needs account authentication or access
to every generated token.

The Docker provider needs account authentication as `shepherdjerred`: either
an account password injected into `DOCKER_USERNAME` and `DOCKER_PASSWORD`
through the existing 1Password wrapper, or a Docker Desktop account login in
the native credential store. A registry PAT, including one with repository
admin permission, cannot authenticate Docker's token-management API. Account
authentication with MFA must use a supported account session; this provider
does not expose a second-factor challenge input. No account password belongs
in CI, a Terraform variable, or a tracked file.

The stack wrapper forwards the existing SeaweedFS state credentials and a
dedicated `TOFU_STATE_ENCRYPTION_PASSPHRASE`. For this operator-only stack it
also forwards an explicitly supplied pair of `DOCKER_USERNAME` and
`DOCKER_PASSWORD`; a partial pair fails before backend initialization. Do not
inject the repository-management PAT into those variables. CI can validate
this stack, but the wrapper rejects every live operation from CI. The account
API preflight and username precondition run before token creation.
The wrapper prints only planned resource addresses and actions. It captures
both provider output streams and withholds authentication diagnostics, which
can contain second-factor challenge tokens.

```sh
bun packages/homelab/scripts/tofu/tofu-stack.ts dockerhub-tokens validate
```

Use the authenticated stack wrapper for an operator plan, inspect it, then
apply it. Both state and saved plans require encryption from their first
write. Generated token values are sensitive outputs and remain in encrypted
state. Transfer the output to separate 1Password items through captured
process pipes; never print `tofu output -json` or save decrypted output.
Repository management receives only the management token, publishing receives
only the publisher token, runtime pull secrets receive only the reader token,
and Mend receives only the Renovate token. Account authentication stays local.

Token deletion and scope changes that require replacement are protected by
`prevent_destroy`. Rotate with an explicit replacement and verified credential
handoff before retiring the previous token. Importing a token cannot recover
its value: Docker returns that value only at creation.
