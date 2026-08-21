# AGENTS.md

Layered configuration: `flag → env → file → default`, behind one Zod-typed call
site. Each key declares its schema, the layers allowed to supply it, and its
default; `get()` returns the value **and the layer it came from**.

## The rule this package exists to enforce

**Fall through on absence, never on a resolved value.**

A source returns `undefined` to mean "I have no opinion" — resolution continues.
Anything else is an **answer** and stops resolution, _including `false` and
`0`_.

If a flag turned off fell through, an env var still set to `true` would silently
re-enable exactly what an operator just disabled. Nothing in a normal test run
would show it. `resolver.test.ts` pins this directly; do not weaken those tests.

Two corollaries that are easy to get wrong:

- **A source that FAILS has not answered.** The error goes to `onSourceError`
  and resolution continues, but the failure is never treated as absence.
- **A present-but-invalid value throws.** A source with an opinion it cannot
  express is a configuration bug; deferring to a lower layer would mask it.
- **An empty-string env var is absent.** Kubernetes materialises unset variables
  as `""`, and treating that as a deliberate empty value would let an accidental
  blank shadow a lower layer.

## Why this package does not depend on `@shepherdjerred/feature-flags`

The `file` layer exists for **apps we distribute to other people**. Someone
self-hosting one of the bots has neither Flipt nor Kubernetes env injection, so
the file is their entire configuration interface. If this package imported the
flag client, every distributed copy would carry a WASM engine it never loads.

The flag layer therefore arrives as an injected `ConfigSource`, and
`@shepherdjerred/feature-flags` supplies the adapter. The dependency points from
the flags package toward this package's interface, never the reverse. Keep it
that way.

## `sources` is the policy, in code

The repo's rule is _"for any app we wrote or control, environment variables are
for credentials and bootstrap; everything else is a feature flag."_

`sources: ["env"]` is an assertion that a key is **bootstrap** — needed to
construct the thing that reads flags (`FLIPT_URL`, `PORT`, `DATABASE_URL`,
`ENVIRONMENT`), so it cannot itself come from a flag. Anything else is a key
that can migrate. That makes the policy machine-checkable rather than prose.

An empty `sources` list is rejected: a key nothing can supply is always its
default, which is a dead knob rather than configuration.

## Rules

- **The default must be current production behavior.** It is what a cold start
  and a backend outage both resolve to, so it is the safe state by definition.
- **`default` is `unknown` at the type level** — the schema types a key — and is
  validated against that schema at resolution. A default that does not satisfy
  its own schema fails loudly instead of typing as the wrong thing.
- **Env and file values arrive as strings.** Use a coercing schema
  (`z.coerce.number()`), not a bare `z.number()`.
- **Mark credentials `sensitive: true`.** The startup dump prints a source and a
  digest for those, never the value; without it a credential lands in stdout and
  then in Loki.
- **Mark per-entity keys `targeted: true`.** Change detection then caches on
  `(key, targetingKey)`. Keyed on the key alone, a per-guild flag answering
  differently for two guilds would log a "change" on every alternation and the
  signal would be noise within an hour.
- **Names are derived by convention** — camelCase key → kebab-case flag,
  SCREAMING_SNAKE env, dotted file path — with per-key overrides, because
  existing env var names are not consistent enough to derive in every case.

## Where a flag does nothing

Check where your read happens before adding a key:

- **Per-call** — evaluated each time the behavior runs. Fully live.
- **Session-scoped** — read once per session or job. Takes effect next session.
- **Boot-wired** — read once at startup to decide what to _construct_. **A flag
  here does nothing until restart.** Move the read to a call site or don't
  bother.

Some values cannot be live regardless of where they are read: ffmpeg encoder
arguments are fixed for the process's lifetime, so flipping one drops the stream
exactly as a redeploy would.
