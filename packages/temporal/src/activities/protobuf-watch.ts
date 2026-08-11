import { z } from "zod/v4";

const ProtobufPackageSchema = z.object({
  name: z.literal("@temporalio/proto"),
  version: z.string().min(1),
  dependencies: z.object({ protobufjs: z.string().min(1) }),
});

export type ProtobufWatchResult = {
  observedAt: string;
  packageVersion: string;
  protobufjsRange: string;
  supportsV8: boolean;
  sourceUrl: string;
  evidenceJson: string;
};

const SOURCE_URL = "https://registry.npmjs.org/@temporalio/proto/latest";

export async function collectProtobufWatch(): Promise<ProtobufWatchResult> {
  const response = await fetch(SOURCE_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `npm registry returned HTTP ${response.status.toString()} for @temporalio/proto`,
    );
  }
  const metadata = ProtobufPackageSchema.parse(await response.json());
  return {
    observedAt: new Date().toISOString(),
    packageVersion: metadata.version,
    protobufjsRange: metadata.dependencies.protobufjs,
    supportsV8: Bun.semver.satisfies("8.0.0", metadata.dependencies.protobufjs),
    sourceUrl: SOURCE_URL,
    evidenceJson: JSON.stringify(metadata),
  };
}

export const protobufWatchActivities = { collectProtobufWatch };
export type ProtobufWatchActivities = typeof protobufWatchActivities;
