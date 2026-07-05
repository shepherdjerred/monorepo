// Shared in-memory tracer provider for unit tests. OTel allows exactly one
// global provider registration per process; bun runs every test file in the
// same process, so each file registering its own provider would leave all but
// the first exporting nowhere. Import { exporter } from here instead and call
// exporter.reset() at the top of each test.

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace } from "@opentelemetry/api";

export const exporter = new InMemorySpanExporter();

const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({ "service.name": "test-service" }),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

trace.setGlobalTracerProvider(provider);
