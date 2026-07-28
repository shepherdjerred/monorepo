import type { ConnectionOptions } from "@temporalio/client";
import { z } from "zod/v4";

const TemporalTlsSchema = z.enum(["true", "false"]).optional();

export function temporalConnectionOptions(input: {
  environment: Readonly<Record<string, string | undefined>>;
  defaultAddress: string;
}): ConnectionOptions {
  const tls = TemporalTlsSchema.parse(input.environment["TEMPORAL_TLS"]);
  return {
    address: input.environment["TEMPORAL_ADDRESS"] ?? input.defaultAddress,
    ...(tls === "true" ? { tls: true } : {}),
  };
}
