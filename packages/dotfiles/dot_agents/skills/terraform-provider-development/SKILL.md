---
name: terraform-provider-development
description: "Build, extend, test, document, and migrate Terraform providers with the Plugin Framework. Use when scaffolding a…"
license: MPL-2.0
---

# Terraform Provider Development

Use this repo-owned workflow for production-quality Terraform providers. It
combines the active HashiCorp provider-development guidance with the local
Terraform/OpenTofu safety rules. The copied examples and deeper references are
in `assets/` and `references/`; read only the relevant one for the current task.

## Scope and safety

- Confirm the provider API, supported Terraform versions, and whether the
  provider is SDKv2-only, Framework-only, or muxed before changing code.
- Keep credentials out of source, plans, state, fixtures, and logs. Provider
  configuration attributes carrying secrets are optional and sensitive, with
  documented environment-variable fallbacks and redacted diagnostics.
- Acceptance tests can create and destroy real infrastructure. Require explicit
  authorization, use the provider's documented test environment variables, and
  never turn a missing credential into a skipped test or a false pass.
- Use Go's repository toolchain and run focused tests before broad verification:
  `go test ./...`, `go vet ./...`, and the provider's configured lint or docs
  commands. Do not add a dependency only to hide a failing check.

## New provider scaffold

For a new `terraform-provider-*` project:

1. Create or confirm the provider workspace and initialize its Go module.
2. Add the Plugin Framework and provider server entrypoint. The starter
   examples are `assets/main.go` and `assets/provider.go`.
3. Implement provider schema and `Configure`, then run `go mod tidy`,
   `go build`, and `go test ./...`.
4. Add authentication validation and a deterministic credential chain before
   adding resources. Read `references/hashicorp-provider-configuration/` for
   the detailed chain and case studies.

## Provider configuration

Model credentials as optional, sensitive schema attributes so configuration,
environment variables, shared profiles, or platform identity can be composed.
Resolve known values in `Configure`, report every attempted source without
printing secret values, and return diagnostics for missing or invalid
credentials. Preserve unknown values until Terraform has enough information to
configure the provider; do not silently select an unrelated account.

## Resources, data sources, and actions

- Use the Plugin Framework for new resources and data sources. Use CRUD methods,
  validators, plan modifiers, not-found handling, and waiters that match the
  API's consistency model.
- Model a data source as a read-only lookup, not a resource with an accidental
  delete path. Define import behavior and stable identity before implementation.
- Treat actions as an explicit experimental feature and document lifecycle
  timing, idempotency, retries, and failure behavior.
- Add acceptance coverage for every resource/data source and important import,
  drift, not-found, validation, and eventual-consistency path.

Read `references/hashicorp-provider-resources/` and
`references/hashicorp-provider-test-patterns/` for detailed design and test
patterns.

## Documentation and release readiness

Keep schema descriptions precise, add only templates for implemented objects,
and generate docs with the repository's `tfplugindocs` workflow. Verify examples
against the provider code and ensure provider, resource, data source, action,
and guide docs agree. Read
`references/hashicorp-provider-docs/hashicorp-provider-docs.md` before changing
templates.

## Framework migrations

For SDKv2-to-Framework work, inventory state shape and null/zero-value behavior
first. Preserve existing addresses and semantics, use muxing where a staged
migration is required, and add regression tests before changing schemas. Read
`references/hashicorp-provider-framework-migration/schema-mapping.md` for the
mapping and compatibility traps.

## Acceptance and CI

Run unit and protocol tests without credentials first. Run acceptance tests only
with explicit authorization and a disposable test account/project. Keep cleanup
failures visible, use stable test names, and record the exact Terraform/Go/
provider versions. The upstream acceptance workflow is summarized by the local
test-pattern references; this skill does not assume GitHub Actions, a hosted
runner, or a particular CI provider.

The upstream source paths, exact commit, and manual-review notes are recorded in
`public-sources.json`. Do not overwrite this skill wholesale during an update.
