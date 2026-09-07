import { z } from "zod";

/**
 * Wire envelope for every versioned domain payload. The envelope is strict:
 * exactly `{ kind, version, data }`, no extra keys.
 */
export type VersionedEnvelope<Kind extends string, Data> = {
  readonly kind: Kind;
  readonly version: number;
  readonly data: Data;
};

/**
 * A codec for one payload kind. `parse` accepts an envelope at any supported
 * version, migrates it forward step by step, and validates the result against
 * the current schema. `serialize` re-validates the value and wraps it in a
 * current-version envelope.
 */
export type VersionedCodec<Kind extends string, Schema extends z.ZodType> = {
  readonly kind: Kind;
  readonly version: number;
  readonly parse: (json: unknown) => z.infer<Schema>;
  readonly serialize: (
    value: z.infer<Schema>,
  ) => VersionedEnvelope<Kind, z.infer<Schema>>;
};

const CodecKindSchema = z.string().min(1);
const CodecVersionSchema = z.number().int().min(1);

type Migration = (old: unknown) => unknown;

/**
 * Validate the migration table at definition time. Keys must form a contiguous
 * run of from-versions ending at `version - 1`; anything else means some
 * historical version could never reach the current schema, which is a broken
 * codec definition rather than bad wire data.
 */
function resolveMigrationChain(args: {
  version: number;
  migrations: Readonly<Record<number, Migration>> | undefined;
}): {
  byFromVersion: ReadonlyMap<number, Migration>;
  minSupportedVersion: number;
} {
  const MigrationFromVersionSchema = CodecVersionSchema.max(args.version - 1);
  const entries = Object.entries(args.migrations ?? {}).map(
    ([rawFromVersion, migrate]) => ({
      fromVersion: MigrationFromVersionSchema.parse(Number(rawFromVersion)),
      migrate,
    }),
  );
  const sorted = [...entries].sort((a, b) => a.fromVersion - b.fromVersion);
  const minSupportedVersion = args.version - sorted.length;
  for (const [index, entry] of sorted.entries()) {
    const expectedFromVersion = minSupportedVersion + index;
    if (entry.fromVersion !== expectedFromVersion) {
      throw new Error(
        `migrations for a version-${String(args.version)} codec must form a contiguous run ending at ${String(args.version - 1)}; expected a migration from version ${String(expectedFromVersion)}, found ${String(entry.fromVersion)}`,
      );
    }
  }
  return {
    byFromVersion: new Map(
      sorted.map((entry) => [entry.fromVersion, entry.migrate]),
    ),
    minSupportedVersion,
  };
}

/**
 * Define a versioned codec for one payload kind.
 *
 * `migrations[n]` upgrades a version-`n` payload to version `n + 1`. An
 * envelope whose version has no complete migration chain to the current
 * version is unknown and rejected, as is an envelope with the wrong kind, a
 * non-integer version, or extra keys.
 */
export function defineVersionedCodec<
  Kind extends string,
  Schema extends z.ZodType,
>(args: {
  kind: Kind;
  version: number;
  schema: Schema;
  migrations?: Readonly<Record<number, (old: unknown) => unknown>>;
}): VersionedCodec<Kind, Schema> {
  CodecKindSchema.parse(args.kind);
  const version = CodecVersionSchema.parse(args.version);
  const { byFromVersion, minSupportedVersion } = resolveMigrationChain({
    version,
    migrations: args.migrations,
  });
  const EnvelopeSchema = z.strictObject({
    kind: z.literal(args.kind),
    version: z.number().int(),
    data: z.unknown(),
  });
  const parse = (json: unknown): z.infer<Schema> => {
    const envelope = EnvelopeSchema.parse(json);
    if (envelope.version > version || envelope.version < minSupportedVersion) {
      throw new Error(
        `unknown ${args.kind} envelope version ${String(envelope.version)}; supported versions are ${String(minSupportedVersion)} through ${String(version)}`,
      );
    }
    let payload: unknown = envelope.data;
    for (
      let fromVersion = envelope.version;
      fromVersion < version;
      fromVersion += 1
    ) {
      const migrate = byFromVersion.get(fromVersion);
      if (migrate === undefined) {
        throw new Error(
          `broken migration chain for ${args.kind}: no migration from version ${String(fromVersion)}`,
        );
      }
      payload = migrate(payload);
    }
    return args.schema.parse(payload);
  };
  return {
    kind: args.kind,
    version,
    parse,
    serialize: (value) => ({
      kind: args.kind,
      version,
      data: args.schema.parse(value),
    }),
  };
}
