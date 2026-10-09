import type { ConnectionOptions } from "@temporalio/client";
import { z } from "zod/v4";

const TemporalTlsSchema = z.enum(["true", "false"]).optional();

export function temporalConnectionOptions(input: {
  environment: Readonly<Record<string, string | undefined>>;
  defaultAddress: string;
}): ConnectionOptions {
  const tls = TemporalTlsSchema.parse(input.environment["TEMPORAL_TLS"]);
  const apiKey = input.environment["TEMPORAL_API_KEY"];
  if (apiKey !== undefined && (tls !== "true" || apiKey.length === 0)) {
    throw new Error("A nonempty TEMPORAL_API_KEY requires TEMPORAL_TLS=true");
  }
  return {
    address: input.environment["TEMPORAL_ADDRESS"] ?? input.defaultAddress,
    ...(tls === "true" ? { tls: true } : {}),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}
