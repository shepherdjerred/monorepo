import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { Persona } from "./personas.ts";

/** What a fixture handler knows about the request it answers. */
export type FixtureRequest = {
  persona: Persona;
  user: MediaUser;
  query: URLSearchParams;
  /** A `:name` segment of the endpoint path. Throws when it is not declared. */
  param: (name: string) => string;
};

export type FixtureEndpoint = {
  /** The `/api/v<version>` prefix the client reads this path under. */
  version: 1 | 2 | 3 | 4;
  /** Path below the version prefix; `:name` matches one segment. */
  path: string;
  /** `owner` endpoints answer a member with a typed 403. */
  access: "household" | "owner";
  /** The schema the client parses this response with. */
  schema: z.ZodType;
  /** The response body, or null when the addressed record does not exist. */
  respond: (request: FixtureRequest) => unknown;
  /**
   * Parse a body exactly as the client does: the schema, then any ownership
   * check the client adds with `.refine()` after it.
   */
  parse: (body: unknown, request: FixtureRequest) => unknown;
  /** Paths (with query) below the version prefix that the schema test reads. */
  samples: readonly string[];
};

type Definition<S extends z.ZodType> = {
  version?: FixtureEndpoint["version"];
  path: string;
  access?: FixtureEndpoint["access"];
  schema: S;
  respond: (request: FixtureRequest) => z.input<S> | null;
  /** The client's own `.refine()` on this call, when it has one. */
  belongsToRequest?: (value: z.output<S>, request: FixtureRequest) => boolean;
  samples: readonly string[];
};

/** Declare one row of the endpoint table, typed against its client schema. */
export function endpoint<S extends z.ZodType>(
  definition: Definition<S>,
): FixtureEndpoint {
  const { schema, belongsToRequest } = definition;
  return {
    version: definition.version ?? 1,
    path: definition.path,
    access: definition.access ?? "household",
    schema,
    respond: definition.respond,
    parse: (body, request) => {
      const value = schema.parse(body);
      if (belongsToRequest !== undefined && !belongsToRequest(value, request)) {
        throw new Error(
          `${definition.path}: the response belongs to another request`,
        );
      }
      return value;
    },
    samples: definition.samples,
  };
}
