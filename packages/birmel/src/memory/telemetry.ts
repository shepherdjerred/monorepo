import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

const memoryTracer = trace.getTracer("birmel.memory");

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function withMemorySpan<T>(
  name: string,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return memoryTracer.startActiveSpan(name, async (span) => {
    span.setAttribute("operation.name", name);
    try {
      const result = await run(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setAttribute("error.type", errorClass(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
