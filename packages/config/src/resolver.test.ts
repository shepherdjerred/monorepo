import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  defineConfig,
  formatConfigDump,
} from "@shepherdjerred/config/index.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import type { ConfigKeyDefinition } from "@shepherdjerred/config/definition.ts";
import type {
  ConfigKeyNames,
  ConfigSource,
  SourceResult,
} from "@shepherdjerred/config/source.ts";

/** A source backed by a plain map. `undefined` entries mean absent. */
function mapSource(
  name: ConfigSource["name"],
  values: Readonly<Record<string, unknown>>,
): ConfigSource {
  return {
    name,
    get: (names: ConfigKeyNames): Promise<SourceResult | undefined> =>
      Promise.resolve(
        Object.hasOwn(values, names.key)
          ? { value: values[names.key] }
          : undefined,
      ),
  };
}

function failingSource(
  name: ConfigSource["name"],
  message: string,
): ConfigSource {
  return {
    name,
    get: () => Promise.reject(new Error(message)),
  };
}

describe("precedence", () => {
  test("flag wins over env, env over file, file over default", async () => {
    const definition = {
      knob: {
        schema: z.string(),
        sources: ["flag", "env", "file", "default"],
        default: "from-default",
      },
    } as const;

    const all = defineConfig({
      definition,
      sources: {
        flag: mapSource("flag", { knob: "from-flag" }),
        env: mapSource("env", { knob: "from-env" }),
        file: mapSource("file", { knob: "from-file" }),
      },
    });
    await expect(all.get("knob")).resolves.toEqual({
      value: "from-flag",
      source: "flag",
    });

    const withoutFlag = defineConfig({
      definition,
      sources: {
        env: mapSource("env", { knob: "from-env" }),
        file: mapSource("file", { knob: "from-file" }),
      },
    });
    await expect(withoutFlag.get("knob")).resolves.toEqual({
      value: "from-env",
      source: "env",
    });

    const fileOnly = defineConfig({
      definition,
      sources: { file: mapSource("file", { knob: "from-file" }) },
    });
    await expect(fileOnly.get("knob")).resolves.toEqual({
      value: "from-file",
      source: "file",
    });

    const none = defineConfig({ definition, sources: {} });
    await expect(none.get("knob")).resolves.toEqual({
      value: "from-default",
      source: "default",
    });
  });
});

describe("absence vs. answer", () => {
  test("forwards targeting context to each source read", async () => {
    const targetingKeys: (string | undefined)[] = [];
    const source: ConfigSource = {
      name: "flag",
      get: (_names, context) => {
        targetingKeys.push(context?.targetingKey);
        return Promise.resolve({ value: "guild-value" });
      },
    };
    const resolver = defineConfig({
      definition: {
        value: {
          schema: z.string(),
          sources: ["flag", "default"],
          default: "default-value",
          targeted: true,
        },
      } as const,
      sources: { flag: source },
    });

    await expect(
      resolver.value("value", { targetingKey: "guild-123" }),
    ).resolves.toBe("guild-value");
    expect(targetingKeys).toEqual(["guild-123"]);
  });

  test("a flag resolving FALSE stops the waterfall", async () => {
    // The correctness property this package exists for. If `false` fell
    // through, the env var below would silently re-enable exactly what an
    // operator turned off.
    const resolver = defineConfig({
      definition: {
        featureOn: {
          schema: z.boolean(),
          sources: ["flag", "env", "default"],
          default: true,
        },
      } as const,
      sources: {
        flag: mapSource("flag", { featureOn: false }),
        env: mapSource("env", { featureOn: true }),
      },
    });
    await expect(resolver.get("featureOn")).resolves.toEqual({
      value: false,
      source: "flag",
    });
  });

  test("an empty string from env is absent, not an answer", async () => {
    // Kubernetes materialises unset variables as "", and treating that as a
    // deliberate empty value would let a blank shadow a lower layer.
    const resolver = defineConfig({
      definition: {
        name: {
          schema: z.string(),
          sources: ["env", "default"],
          default: "fallback",
        },
      } as const,
      sources: { env: createEnvSource({ NAME: "" }) },
    });
    await expect(resolver.get("name")).resolves.toEqual({
      value: "fallback",
      source: "default",
    });
  });

  test("zero and false from a source are answers, not absence", async () => {
    const resolver = defineConfig({
      definition: {
        threshold: {
          schema: z.number(),
          sources: ["flag", "default"],
          default: 42,
        },
      } as const,
      sources: { flag: mapSource("flag", { threshold: 0 }) },
    });
    await expect(resolver.get("threshold")).resolves.toEqual({
      value: 0,
      source: "flag",
    });
  });

  test("a source that FAILS does not answer, and does not stop resolution", async () => {
    const errors: string[] = [];
    const resolver = defineConfig({
      definition: {
        knob: {
          schema: z.string(),
          sources: ["flag", "env", "default"],
          default: "from-default",
        },
      } as const,
      sources: {
        flag: failingSource("flag", "backend exploded"),
        env: mapSource("env", { knob: "from-env" }),
      },
      hooks: {
        onSourceError: (key, source, message) => {
          errors.push(`${key}/${source}: ${message}`);
        },
      },
    });
    await expect(resolver.get("knob")).resolves.toEqual({
      value: "from-env",
      source: "env",
    });
    expect(errors).toEqual(["knob/flag: backend exploded"]);
  });

  test("a present-but-invalid value throws instead of falling through", async () => {
    // A source with an opinion it cannot express is a configuration bug.
    // Deferring to a lower layer would mask it.
    const resolver = defineConfig({
      definition: {
        port: {
          schema: z.coerce.number().int().positive(),
          sources: ["env", "default"],
          default: 8080,
        },
      } as const,
      sources: { env: createEnvSource({ PORT: "not-a-number" }) },
    });
    await expect(resolver.get("port")).rejects.toThrow(/failed validation/);
  });
});

describe("name derivation", () => {
  test("derives flag, env, and file names from the declaration key", async () => {
    const resolver = defineConfig({
      definition: {
        llmModelName: {
          schema: z.string(),
          sources: ["env", "default"],
          default: "unset",
        },
      } as const,
      sources: { env: createEnvSource({ LLM_MODEL_NAME: "from-env" }) },
    });
    await expect(resolver.value("llmModelName")).resolves.toBe("from-env");
  });

  test("honours a per-key override", async () => {
    const resolver = defineConfig({
      definition: {
        exploreAllowlist: {
          schema: z.string(),
          sources: ["env", "default"],
          default: "unset",
          names: { env: "EXPLORE_GUILD_ALLOWLIST" },
        },
      } as const,
      sources: {
        env: createEnvSource({ EXPLORE_GUILD_ALLOWLIST: "a,b" }),
      },
    });
    await expect(resolver.value("exploreAllowlist")).resolves.toBe("a,b");
  });
});

describe("declaration validation", () => {
  test("rejects a key with no sources", () => {
    expect(() =>
      defineConfig({
        definition: {
          dead: { schema: z.string(), sources: [], default: "x" },
        } as const,
        sources: {},
      }),
    ).toThrow(/declares no sources/);
  });

  test("rejects a duplicated source", () => {
    expect(() =>
      defineConfig({
        definition: {
          ambiguous: {
            schema: z.string(),
            sources: ["env", "env"],
            default: "x",
          },
        } as const,
        sources: {},
      }),
    ).toThrow(/more than once/);
  });

  test("rejects reading an unknown key", async () => {
    // Typed with an index signature so an arbitrary key is allowed at the type
    // level and the RUNTIME guard is what gets exercised. A concrete
    // definition already makes this a compile error, which is the primary
    // protection; this covers a key arriving from outside TypeScript.
    const definition: Record<string, ConfigKeyDefinition> = {
      known: { schema: z.string(), sources: ["default"], default: "x" },
    };
    const resolver = defineConfig({ definition, sources: {} });
    await expect(resolver.get("unknown")).rejects.toThrow(/unknown config key/);
  });
});

describe("change detection", () => {
  test("reports a value change once, not on every read", async () => {
    const changes: string[] = [];
    let current = "a";
    const resolver = defineConfig({
      definition: {
        knob: {
          schema: z.string(),
          sources: ["flag", "default"],
          default: "z",
        },
      } as const,
      sources: {
        flag: {
          name: "flag",
          get: () => Promise.resolve({ value: current }),
        },
      },
      hooks: {
        onChange: (event) => {
          changes.push(`${String(event.previous)}→${String(event.next)}`);
        },
      },
    });

    await resolver.get("knob");
    await resolver.get("knob");
    expect(changes).toEqual([]); // no change yet, and the first read is not one

    current = "b";
    await resolver.get("knob");
    await resolver.get("knob");
    expect(changes).toEqual(["a→b"]);
  });

  test("a targeted key does not report a change across different entities", async () => {
    // A per-guild flag legitimately answers differently per guild. Keyed on the
    // config key alone, alternating reads would log a "change" every time and
    // the signal would be noise within an hour.
    const changes: string[] = [];
    const resolver = defineConfig({
      definition: {
        perGuild: {
          schema: z.boolean(),
          sources: ["flag", "default"],
          default: false,
          targeted: true,
        },
      } as const,
      sources: {
        flag: {
          name: "flag",
          get: () => Promise.resolve({ value: nextValue }),
        },
      },
      hooks: {
        onChange: (event) => {
          changes.push(String(event.next));
        },
      },
    });

    let nextValue = true;
    await resolver.get("perGuild", { targetingKey: "guild-a" });
    nextValue = false;
    await resolver.get("perGuild", { targetingKey: "guild-b" });
    nextValue = true;
    await resolver.get("perGuild", { targetingKey: "guild-a" });
    nextValue = false;
    await resolver.get("perGuild", { targetingKey: "guild-b" });

    expect(changes).toEqual([]);
  });
});

describe("startup dump", () => {
  test("shows the source and eligible layers for every key", async () => {
    const resolver = defineConfig({
      definition: {
        knob: {
          schema: z.string(),
          sources: ["env", "default"],
          default: "d",
        },
      } as const,
      sources: { env: createEnvSource({ KNOB: "from-env" }) },
    });
    const dump = formatConfigDump(await resolver.describe());
    expect(dump).toContain('knob = "from-env"');
    expect(dump).toContain("source: env");
    expect(dump).toContain("eligible: env → default");
  });

  test("redacts sensitive keys, printing a digest instead of the value", async () => {
    // Without this a credential resolved through the resolver lands in stdout
    // and then in Loki.
    const resolver = defineConfig({
      definition: {
        apiToken: {
          schema: z.string(),
          sources: ["env", "default"],
          default: "",
          sensitive: true,
        },
      } as const,
      sources: { env: createEnvSource({ API_TOKEN: "super-secret-value" }) },
    });
    const dump = formatConfigDump(await resolver.describe());
    expect(dump).not.toContain("super-secret-value");
    expect(dump).toContain("<redacted sha256:");
  });
});
