import path from "node:path";
import { z } from "zod";
import { formatBlockState, parseBlockState } from "#src/core/block-state.ts";

/**
 * The committed 26.2 block registry, generated from a live MCBridge
 * `/v1/registry` by mc-harness scripts/gen-registry.ts. It is the offline source of truth
 * for which block ids and property values exist.
 */
export const RegistryFileSchema = z.strictObject({
  minecraftVersion: z.string(),
  dataVersion: z.number().int(),
  blocks: z.record(
    z.string(),
    z.strictObject({
      properties: z.record(z.string(), z.array(z.string())),
      defaults: z.record(z.string(), z.string()),
    }),
  ),
});
export type RegistryFile = z.infer<typeof RegistryFileSchema>;

export const REGISTRY_PATH = path.join(
  import.meta.dirname,
  "generated",
  "blocks-26.2.json",
);

export class BlockRegistryError extends Error {
  constructor(
    message: string,
    readonly code: "unknown_block" | "bad_state",
    readonly suggestions: readonly string[],
  ) {
    super(message);
    this.name = "BlockRegistryError";
  }
}

export class BlockRegistry {
  constructor(readonly file: RegistryFile) {}

  get minecraftVersion(): string {
    return this.file.minecraftVersion;
  }

  get dataVersion(): number {
    return this.file.dataVersion;
  }

  has(id: string): boolean {
    return id in this.file.blocks;
  }

  ids(): string[] {
    return Object.keys(this.file.blocks);
  }

  properties(id: string): Readonly<Record<string, readonly string[]>> {
    return this.entry(id).properties;
  }

  /**
   * Validates a state and fills unspecified properties with the block's
   * defaults, returning the full canonical state string. Throws
   * BlockRegistryError with suggestions on unknown ids or values.
   */
  resolve(raw: string): string {
    const state = parseBlockState(raw);
    const entry = this.entry(state.id);
    const properties: Record<string, string> = { ...entry.defaults };
    for (const [key, value] of Object.entries(state.properties)) {
      const allowed = entry.properties[key];
      if (allowed === undefined) {
        throw new BlockRegistryError(
          `${state.id} has no property "${key}" (properties: ${Object.keys(entry.properties).join(", ") || "none"})`,
          "bad_state",
          Object.keys(entry.properties),
        );
      }
      if (!allowed.includes(value)) {
        throw new BlockRegistryError(
          `${state.id}[${key}=${value}] is invalid; ${key} is one of ${allowed.join(", ")}`,
          "bad_state",
          allowed,
        );
      }
      properties[key] = value;
    }
    return formatBlockState({ id: state.id, properties });
  }

  /** Whether `raw` names a known block with valid property values. */
  isValid(raw: string): boolean {
    try {
      this.resolve(raw);
      return true;
    } catch (error) {
      if (error instanceof BlockRegistryError) {
        return false;
      }
      throw error;
    }
  }

  private entry(id: string): RegistryFile["blocks"][string] {
    const entry = this.file.blocks[id];
    if (entry === undefined) {
      const suggestions = suggest(id, this.ids());
      throw new BlockRegistryError(
        `Unknown block ${id}${suggestions.length > 0 ? ` — did you mean ${suggestions.join(", ")}?` : ""}`,
        "unknown_block",
        suggestions,
      );
    }
    return entry;
  }
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] ?? 0) + 1,
        diagonal + cost,
      );
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** Up to three close ids: substring matches first, then edit distance. */
export function suggest(id: string, ids: readonly string[]): string[] {
  const name = id.replace(/^minecraft:/u, "");
  const scored = ids.map((candidate) => {
    const candidateName = candidate.replace(/^minecraft:/u, "");
    const contains =
      candidateName.includes(name) || name.includes(candidateName);
    return {
      candidate,
      score: levenshtein(name, candidateName) - (contains ? 3 : 0),
    };
  });
  return scored
    .filter((entry) => entry.score <= Math.max(3, Math.floor(name.length / 3)))
    .toSorted(
      (a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate),
    )
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

let cached: BlockRegistry | undefined;

/** Loads (once) the committed 26.2 registry. */
export async function loadRegistry(): Promise<BlockRegistry> {
  cached ??= new BlockRegistry(
    RegistryFileSchema.parse(await Bun.file(REGISTRY_PATH).json()),
  );
  return cached;
}
