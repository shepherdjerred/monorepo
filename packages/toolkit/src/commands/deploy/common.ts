import { parseArgs } from "node:util";
import { z } from "zod";

/** Shared argument contract; specialized commands never import the router. */
export function parseDeployArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      machine: { type: "boolean", default: false },
      url: { type: "string" },
      "request-id": { type: "string" },
      "expected-generation": { type: "string" },
      "expected-worker-generation": { type: "string" },
      reason: { type: "string" },
      "operation-id": { type: "string" },
      "plan-fingerprint": { type: "string" },
      decision: { type: "string" },
      timeout: { type: "string" },
      interval: { type: "string" },
      file: { type: "string" },
    },
  });
}
export type DeployOptions = ReturnType<typeof parseDeployArgs>["values"];

export function required(value: string | undefined): string {
  if (value === undefined || value === "")
    throw new Error("Explicit target is required");
  return value;
}
export function generation(value: string): number {
  return z.coerce.number().int().nonnegative().parse(value);
}
export function seconds(value: string): number {
  return z.coerce.number().int().min(1).max(86_400).parse(value);
}
