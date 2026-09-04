import {
  DareToolResultSchema,
  type DareToolResult,
} from "#src/explore/dare-tool-schemas.ts";

export function dareToolResult(
  kind: string,
  message: string,
  data: unknown,
): DareToolResult {
  return DareToolResultSchema.parse({
    kind,
    message,
    data: data === undefined ? null : data,
  });
}

export function dareDomainResult(value: { kind: string }, message: string) {
  return dareToolResult(value.kind, message, value);
}
