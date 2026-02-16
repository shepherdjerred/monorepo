---
name: otel-observability
description: |
  OpenTelemetry observability - tracing, metrics, logs, instrumentation, and context propagation patterns
  When user works with OpenTelemetry, adds tracing/metrics/logging, configures exporters, or mentions spans and observability
---

# OpenTelemetry Observability Agent

## What's New in OpenTelemetry (2024-2025)

- **Stable Logs**: Logging API and SDK now stable in many languages
- **Events API**: New semantic event support
- **Profiling signal**: CPU/memory profiling support (experimental)
- **Enhanced semantic conventions**: Standardized attribute names
- **Collector improvements**: Better performance and reliability
- **OTLP/JSON**: JSON encoding for OTLP widely supported

## Core Concepts

OpenTelemetry (OTel) provides three observability signals:

| Signal | Purpose | Use Case |
|--------|---------|----------|
| **Traces** | Request flow across services | Debugging distributed systems |
| **Metrics** | Numerical measurements | Performance monitoring, alerting |
| **Logs** | Structured event records | Error tracking, audit trails |
| **Baggage** | Context propagation | Passing data across services |

## Installation

### Node.js Packages

```bash
# Core packages
npm install @opentelemetry/api
npm install @opentelemetry/sdk-node
npm install @opentelemetry/sdk-trace-node
npm install @opentelemetry/sdk-metrics

# Auto-instrumentation
npm install @opentelemetry/auto-instrumentations-node

# OTLP exporters
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/exporter-metrics-otlp-http
```

## Zero-Code Instrumentation

### Environment Variables

```bash
# Run with auto-instrumentation
OTEL_TRACES_EXPORTER="otlp" \
OTEL_METRICS_EXPORTER="otlp" \
OTEL_LOGS_EXPORTER="otlp" \
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318" \
OTEL_SERVICE_NAME="my-service" \
OTEL_RESOURCE_ATTRIBUTES="service.version=1.0.0,deployment.environment=production" \
NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register" \
node app.js
```

### Common Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OTEL_SERVICE_NAME` | Service identifier | `"user-service"` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint | `"http://localhost:4318"` |
| `OTEL_TRACES_EXPORTER` | Trace exporter | `"otlp"`, `"console"` |
| `OTEL_METRICS_EXPORTER` | Metrics exporter | `"otlp"`, `"prometheus"` |
| `OTEL_LOGS_EXPORTER` | Logs exporter | `"otlp"`, `"console"` |
| `OTEL_TRACES_SAMPLER` | Sampling strategy | `"parentbased_always_on"` |
| `OTEL_TRACES_SAMPLER_ARG` | Sampler argument | `"0.1"` (10% sampling) |

## Programmatic Setup

### Basic Node.js SDK

```typescript
// instrumentation.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

const sdk = new NodeSDK({
  serviceName: "my-service",

  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),

  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://localhost:4318/v1/metrics",
    }),
    exportIntervalMillis: 60000,
  }),

  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Graceful shutdown
process.on("SIGTERM", () => {
  sdk.shutdown().then(() => process.exit(0));
});
```

### Import Early

```typescript
// app.ts - instrumentation MUST be imported first
import "./instrumentation";

import express from "express";
// ... rest of app
```

## Tracing

### Getting a Tracer

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service", "1.0.0");
```

### Creating Spans

```typescript
// Automatic span management (recommended)
tracer.startActiveSpan("operation-name", (span) => {
  try {
    // Your code here
    span.setAttribute("user.id", userId);
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
});

// Async operations
async function processOrder(orderId: string) {
  return tracer.startActiveSpan("process-order", async (span) => {
    try {
      span.setAttribute("order.id", orderId);
      const result = await orderService.process(orderId);
      return result;
    } finally {
      span.end();
    }
  });
}
```

### Span Kinds

```typescript
import { SpanKind } from "@opentelemetry/api";

// CLIENT - outgoing request (HTTP client, DB call)
tracer.startActiveSpan("fetch-user", { kind: SpanKind.CLIENT }, async (span) => {
  const user = await fetch("/api/users/1");
  span.end();
});

// SERVER - incoming request (HTTP handler)
tracer.startActiveSpan("handle-request", { kind: SpanKind.SERVER }, (span) => {
  // Handle incoming HTTP request
  span.end();
});

// PRODUCER - message production
tracer.startActiveSpan("send-message", { kind: SpanKind.PRODUCER }, (span) => {
  queue.send(message);
  span.end();
});

// CONSUMER - message consumption
tracer.startActiveSpan("process-message", { kind: SpanKind.CONSUMER }, (span) => {
  processMessage(message);
  span.end();
});

// INTERNAL - internal operation (default)
tracer.startActiveSpan("calculate", { kind: SpanKind.INTERNAL }, (span) => {
  const result = heavyCalculation();
  span.end();
});
```

### Span Attributes

```typescript
import { SpanStatusCode } from "@opentelemetry/api";

tracer.startActiveSpan("http-request", (span) => {
  // Set attributes
  span.setAttribute("http.method", "GET");
  span.setAttribute("http.url", "https://api.example.com/users");
  span.setAttribute("http.status_code", 200);

  // Set multiple attributes
  span.setAttributes({
    "user.id": "123",
    "user.role": "admin",
    "request.cached": false,
  });

  // Add events
  span.addEvent("cache-miss", {
    "cache.key": "user:123",
  });

  // Set status
  span.setStatus({ code: SpanStatusCode.OK });

  span.end();
});
```

### Error Handling

```typescript
tracer.startActiveSpan("risky-operation", (span) => {
  try {
    riskyOperation();
  } catch (error) {
    // Record the exception
    span.recordException(error as Error);

    // Set error status
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (error as Error).message,
    });

    throw error;
  } finally {
    span.end();
  }
});
```

## Metrics

### Getting a Meter

```typescript
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("my-service", "1.0.0");
```

### Counter (Monotonic Increasing)

```typescript
// Create counter
const requestCounter = meter.createCounter("http.requests.total", {
  description: "Total number of HTTP requests",
  unit: "1",
});

// Increment
requestCounter.add(1, {
  "http.method": "GET",
  "http.route": "/api/users",
  "http.status_code": 200,
});
```

### UpDownCounter (Can Decrease)

```typescript
const activeConnections = meter.createUpDownCounter("connections.active", {
  description: "Number of active connections",
  unit: "1",
});

// Increment on connect
activeConnections.add(1);

// Decrement on disconnect
activeConnections.add(-1);
```

### Histogram (Distribution)

```typescript
const requestDuration = meter.createHistogram("http.request.duration", {
  description: "HTTP request duration",
  unit: "ms",
});

// Record value
const start = performance.now();
await handleRequest();
const duration = performance.now() - start;

requestDuration.record(duration, {
  "http.method": "POST",
  "http.route": "/api/orders",
});
```

### Observable Gauge (Async Measurement)

```typescript
// For values that are measured periodically
const memoryUsage = meter.createObservableGauge("process.memory.heap", {
  description: "Heap memory usage",
  unit: "By",
});

memoryUsage.addCallback((result) => {
  const usage = process.memoryUsage();
  result.observe(usage.heapUsed, {
    "memory.type": "heap",
  });
});
```

### Observable Counter (Async Monotonic)

```typescript
const cpuTime = meter.createObservableCounter("process.cpu.time", {
  description: "CPU time used",
  unit: "s",
});

cpuTime.addCallback((result) => {
  const usage = process.cpuUsage();
  result.observe(usage.user / 1e6, { "cpu.mode": "user" });
  result.observe(usage.system / 1e6, { "cpu.mode": "system" });
});
```

## Context Propagation

### W3C Trace Context

OpenTelemetry uses W3C Trace Context by default:

```
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
             │  │                                │                │
             │  │                                │                └─ Flags (sampled)
             │  │                                └─ Parent Span ID
             │  └─ Trace ID
             └─ Version
```

### Manual Context Propagation

```typescript
import { context, propagation, trace } from "@opentelemetry/api";

// Inject context into headers (outgoing request)
function makeRequest(url: string) {
  const headers: Record<string, string> = {};

  propagation.inject(context.active(), headers);

  return fetch(url, { headers });
}

// Extract context from headers (incoming request)
function handleRequest(req: Request) {
  const ctx = propagation.extract(context.active(), req.headers);

  return context.with(ctx, () => {
    return tracer.startActiveSpan("handle-request", (span) => {
      // Process request
      span.end();
    });
  });
}
```

### Baggage

```typescript
import { propagation, context } from "@opentelemetry/api";

// Set baggage
const baggage = propagation.createBaggage({
  "user.id": { value: "123" },
  "tenant.id": { value: "acme" },
});

const ctx = propagation.setBaggage(context.active(), baggage);

context.with(ctx, () => {
  // Baggage is now available in this context
  makeDownstreamRequest();
});

// Read baggage
const currentBaggage = propagation.getBaggage(context.active());
const userId = currentBaggage?.getEntry("user.id")?.value;
```

## Sampling Strategies

### Configuration

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from "@opentelemetry/sdk-trace-node";

// Always sample (development)
const alwaysOn = new AlwaysOnSampler();

// Never sample (disable tracing)
const alwaysOff = new AlwaysOffSampler();

// Sample 10% of traces
const ratioSampler = new TraceIdRatioBasedSampler(0.1);

// Parent-based with ratio fallback (recommended for production)
const parentBasedSampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1),
});

const sdk = new NodeSDK({
  sampler: parentBasedSampler,
  // ...
});
```

### Environment Variable Sampling

```bash
# Always sample
OTEL_TRACES_SAMPLER=always_on

# Never sample
OTEL_TRACES_SAMPLER=always_off

# Ratio-based (10%)
OTEL_TRACES_SAMPLER=traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1

# Parent-based with ratio root
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

## Exporters

### Console (Development)

```typescript
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { ConsoleMetricExporter } from "@opentelemetry/sdk-metrics";

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new ConsoleMetricExporter(),
  }),
});
```

### OTLP (Production)

```typescript
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";

// HTTP/JSON
const traceExporter = new OTLPTraceExporter({
  url: "http://collector:4318/v1/traces",
  headers: { "x-api-key": process.env.API_KEY },
});

// gRPC (better performance)
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from "@opentelemetry/exporter-trace-otlp-grpc";

const grpcExporter = new OTLPTraceExporterGrpc({
  url: "grpc://collector:4317",
});
```

### Jaeger

```typescript
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";

const jaegerExporter = new JaegerExporter({
  endpoint: "http://jaeger:14268/api/traces",
});
```

### Prometheus (Metrics)

```typescript
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

const promExporter = new PrometheusExporter({
  port: 9464,
  endpoint: "/metrics",
});
```

## Common Instrumentation Patterns

### HTTP Server Middleware

```typescript
// Express middleware
import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("express-app");

app.use((req, res, next) => {
  const ctx = propagation.extract(context.active(), req.headers);

  context.with(ctx, () => {
    tracer.startActiveSpan(
      `${req.method} ${req.path}`,
      { kind: SpanKind.SERVER },
      (span) => {
        span.setAttributes({
          "http.method": req.method,
          "http.url": req.url,
          "http.route": req.path,
        });

        res.on("finish", () => {
          span.setAttribute("http.status_code", res.statusCode);
          if (res.statusCode >= 400) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
        });

        next();
      }
    );
  });
});
```

### Database Query Wrapper

```typescript
async function tracedQuery<T>(name: string, query: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { kind: SpanKind.CLIENT }, async (span) => {
    try {
      span.setAttribute("db.system", "postgresql");
      const result = await query();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Usage
const users = await tracedQuery("SELECT users", () =>
  prisma.user.findMany()
);
```

### Background Job Tracing

```typescript
async function processJob(job: Job) {
  // Extract context from job metadata
  const ctx = propagation.extract(context.active(), job.metadata);

  return context.with(ctx, () => {
    return tracer.startActiveSpan(
      `job:${job.type}`,
      { kind: SpanKind.CONSUMER },
      async (span) => {
        span.setAttributes({
          "job.id": job.id,
          "job.type": job.type,
          "job.attempts": job.attempts,
        });

        try {
          await executeJob(job);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  });
}
```

## Semantic Conventions

Use standard attribute names for consistency:

### HTTP

```typescript
{
  "http.method": "GET",
  "http.url": "https://api.example.com/users",
  "http.route": "/users/:id",
  "http.status_code": 200,
  "http.request_content_length": 1024,
  "http.response_content_length": 2048,
}
```

### Database

```typescript
{
  "db.system": "postgresql",
  "db.name": "mydb",
  "db.statement": "SELECT * FROM users WHERE id = $1",
  "db.operation": "SELECT",
  "db.sql.table": "users",
}
```

### Messaging

```typescript
{
  "messaging.system": "rabbitmq",
  "messaging.destination": "orders",
  "messaging.operation": "publish",
  "messaging.message_id": "abc123",
}
```

## Best Practices Summary

1. **Use auto-instrumentation** - covers common libraries automatically
2. **Follow semantic conventions** - use standard attribute names
3. **Set service name** - essential for trace identification
4. **Always end spans** - use try/finally or context managers
5. **Record exceptions** - use `span.recordException()`
6. **Set span status** - mark errors with `ERROR` status
7. **Use parent-based sampling** - maintains trace consistency
8. **Batch exports** - configure appropriate batch sizes
9. **Graceful shutdown** - flush telemetry before exit
10. **Avoid high cardinality** - don't use UUIDs as attribute values

## When to Ask for Help

- Custom instrumentation for proprietary protocols
- Tail-based sampling configuration
- OpenTelemetry Collector deployment
- Performance tuning for high-throughput systems
- Correlation with logs and metrics
- Multi-language tracing consistency
