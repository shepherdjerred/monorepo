# OpenRouter BYOK OpenTofu provider

This local provider fills the BYOK resource gap in the pinned
`cloudopsworks/openrouter` provider. It uses OpenRouter's management API and is
installed by `packages/homelab/scripts/tofu-stack.ts` through a temporary
filesystem mirror, so the provider binary is built from this checkout for the
current CI/operator platform.

The raw key is sensitive and requires replacement on change. Reads never
replace it with an API response because OpenRouter treats BYOK material as
write-only. A 404 removes the resource from state, and delete accepts an
already-absent credential.

```bash
go test ./...
go vet ./...
go build ./...
```
