import {
  createConsoleTRPCClient,
  createConsoleTRPCReact,
} from "@shepherdjerred/console-client";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import type { AppRouter } from "#shared/trpc-contract.ts";

export const { TRPCProvider, useTRPC } = createConsoleTRPCReact<AppRouter>();

export function createGolinkTRPCClient() {
  return createConsoleTRPCClient<AppRouter>();
}

const ErrorDataSchema = z.object({
  zodError: z
    .object({ fieldErrors: z.record(z.string(), z.array(z.string())) })
    .nullish(),
});

/**
 * What a failed call says to the reader. Server-side Zod issues arrive as
 * `zodError`; the form validates the same rules first, so they are rare.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof TRPCClientError) {
    const data: unknown = error.data;
    const parsed = ErrorDataSchema.safeParse(data);
    const issues = Object.values(
      parsed.data?.zodError?.fieldErrors ?? {},
    ).flat();
    if (issues.length > 0) return issues.join(" ");
    if (error.message.trim().length > 0) return error.message;
  }
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}
