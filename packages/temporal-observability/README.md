# Temporal observability

Shared tracing adapters for central Temporal and Scout workers. Client and
Activity adapters run in the host process; the `workflow-interceptors` entrypoint
runs only in the Workflow sandbox.

Use `createTemporalWorkerTracing` to register the Workflow factory, Activity
interceptors and validated exporter sink together. The upstream SDK's Workflow
module exports interceptor classes, so listing that module directly does not
register tracing. The shared entrypoint supplies the factory required by Worker.

The sink validates the installed v2 SDK's serialized span contract, including
`parentSpanContext` and `instrumentationScope`, and preserves parentage when
forwarding spans to the host processor. It does not export replayed spans.

The central Workflow test suite exercises a real client → Workflow → Activity
trace against a disposable Temporal server, including trace identity and parent
links. Package unit tests cover strict wire validation and resource metadata.
