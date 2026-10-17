import { z } from "zod";
import type { RegexMatcher } from "#domain/resolved-contract.ts";
import protocol from "./regex-protocol.schema.json";
import { readRegexSchema } from "./regex-schema.ts";

const responseValidator = z.fromJSONSchema(
  readRegexSchema(protocol.$defs.response),
);

export const RegexObservationsSchema = z.preprocess(
  (value) => responseValidator.parse(value),
  z.object({
    protocolVersion: z.literal(1),
    engine: z.literal("dotnet-ignorecase"),
    runtimeVersion: z.string().min(1),
    culture: z.string(),
    observations: z.array(
      z.object({
        pattern: z.string().max(8192),
        value: z.string().max(4096),
        result: z.enum(["match", "no_match", "unknown"]),
      }),
    ),
  }),
);

/** No regex translation: absent, timed-out or incompatible source observations protect. */
export function observedRegexMatcher(value: unknown): RegexMatcher {
  const evidence = RegexObservationsSchema.parse(value);
  const observations = new Map<string, "match" | "no_match" | "unknown">();
  for (const item of evidence.observations) {
    const key = JSON.stringify([item.pattern, item.value]);
    const prior = observations.get(key);
    if (prior !== undefined && prior !== item.result)
      throw new Error("Conflicting regex observations");
    observations.set(key, item.result);
  }
  return (pattern, text) =>
    observations.get(JSON.stringify([pattern, text])) ?? "unknown";
}
