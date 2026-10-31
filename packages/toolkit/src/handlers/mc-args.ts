import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { normalizeArgv } from "@shepherdjerred/mc-harness/protocol/argv.ts";

/**
 * Strict argv parsing shared by every `toolkit mc …` handler. Negative
 * coordinates (`-6,-61,-6`) would otherwise parse as options, so argv is
 * normalized first.
 */
export function parseMcArgs<
  const Common extends ParseArgsOptionsConfig,
  const Options extends ParseArgsOptionsConfig,
>(common: Common, args: string[], options: Options) {
  const merged: Common & Options = { ...common, ...options };
  return parseArgs({
    args: normalizeArgv(args, merged),
    options: merged,
    allowPositionals: true,
    strict: true,
  });
}

export function rolloutInput(
  url: string | undefined,
  environment: string | undefined,
) {
  return url === undefined && environment === undefined
    ? {}
    : { rollout: { url, environment } };
}

export function captureFeatureInput(features: string[] | undefined) {
  return features === undefined ? {} : { captureFeatures: features };
}
