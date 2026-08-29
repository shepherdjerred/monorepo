# TypeScript and runtime boundaries

## Package alignment

Keep every `@temporalio/*` package in one project on the same exact version:
Activity, Client, Common, Worker, Workflow, Testing, and any converter/extension
packages. The sandbox, native Core bridge, protocol types, converter behavior,
and test environment evolve together.

Use the installed declarations or version-tagged source for implementation.
The live TypeScript API can reflect a newer release than the repository pin.

This repository pins `@temporalio/activity`, `client`, `common`, `worker`,
`workflow`, and `testing` to 1.22.0. Do not copy a latest-API example without
checking it against 1.22.0.

## Workflow bundle boundary

Workflow code runs in a separate deterministic VM/context and is bundled with
Webpack. Register `workflowsPath` or a bundle created by
`bundleWorkflowCode()`; never import Workflow implementations into the ordinary
Worker process as if they were Activities.

The Workflow graph must not import Node built-ins, Activity implementations, or
Client/Worker/Testing packages at runtime. Import Activity types only and call
typed proxies. An `ignoreModules` escape is safe only when the module is proven
unreachable during Workflow execution; it does not make nondeterministic code
safe.

Prebuild and smoke-test the real production entry graph. Use the same Workflow
interceptors and Payload Converter configuration during bundle/replay as when
the histories were created.

## Data conversion and privacy

- **Payload Converter:** maps TypeScript values to/from Temporal Payloads.
- **Payload Codec:** transforms Payload bytes, commonly compression/encryption.
- **Failure Converter:** maps failures and can cooperate with a codec to protect
  failure messages/stacks.

Configure compatible converters/codecs on every Client and Worker and retain
decoding support for old history payloads. Converter changes are replay/data
compatibility changes, not presentation changes.

The default TypeScript converter handles normal JSON-serializable values plus
supported special cases such as `undefined` and byte arrays. Protobuf conversion
is opt-in; confirm the exact version behavior. SDK 1.23.0 upgrades protobufjs to
v8 and includes a public-type/JSON compatibility surface.

Search Attributes remain plaintext/indexable and do not pass through the normal
Payload Codec. Use `TypedSearchAttributes` and typed keys; old untyped
array-valued maps are deprecated. Never put secrets or PII in Search Attributes.

## Authentic Node support

The SDK officially supports Workers on Node 20, 22, and 24. Worker execution
depends on native modules, Worker Threads, VM contexts, AsyncLocalStorage, and
promise/async hooks. Use an authentic supported Node release and supported libc
image as the generic production baseline.

Client packages may work on Bun, Deno, or edge runtimes, but upstream does not
extend that portability claim to Worker-level Workflow/Activity execution.

## Bun boundary

SDK 1.23.0 added **experimental** Bun 1.4 fixes for reusable VM context
switching, microtasks, and Worker shutdown and expanded Bun CI. Bun still lacks
the V8 promise-hook APIs used for Workflow stack-trace queries. The current SDK
README continues to strongly discourage non-Node Workers.

This repository's Bun 1.4.0 production Worker on SDK 1.22.0 predates those
fixes. Treat it as a locally tested exception, not general Bun support. Do not
expand it to other services or recommend it for a new project.

On every Bun or Temporal SDK change:

1. keep the complete SDK family aligned;
2. build the production Workflow bundle;
3. start/run the Bun Worker path with representative registration and shutdown;
4. run the full authentic-Node Workflow/time-skipping suite serially;
5. replay representative histories under authentic Node using the production
   bundle/converters;
6. inspect release notes for Core, bundler, runtime, test-server, converter, and
   protobuf changes.

Passing only the Node bundle test does not prove the Bun Worker starts. Passing
only Bun unit tests does not prove the native supported Worker/replay path.

## Type safety

Do not copy upstream snippets that use type assertions, non-null assertions,
unvalidated `JSON.parse`, or unparsed heartbeat details. Validate external,
history, and persisted boundaries with control-flow narrowing or a runtime
schema. Do not end a process with `run().catch(console.error)`; surface a failing
exit status and cleanup errors.
