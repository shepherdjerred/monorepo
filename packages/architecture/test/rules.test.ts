import { describe, expect, it } from "vitest";
import { resolveArchitecture } from "#src/definition.ts";
import { fixtureRules, sourceRules } from "#src/rules.ts";

const architecture = resolveArchitecture({
  boundaries: [
    {
      name: "domain-is-pure",
      comment: "the domain must be testable without a database",
      from: "domain",
      to: ["server", "client"],
    },
    {
      name: "client-does-not-import-server-runtime",
      comment: "the browser bundle must not ship server code",
      from: "client",
      to: ["server"],
    },
  ],
});

describe("sourceRules", () => {
  it("always enforces no-circular, restricted to eager runtime edges", () => {
    const [circular] = sourceRules(architecture);
    expect(circular?.name).toBe("no-circular");
    expect(circular?.to).toEqual({
      circular: true,
      viaOnly: { dependencyTypesNot: ["dynamic-import"] },
    });
  });

  it("scopes each boundary to a directory under the source root", () => {
    expect(sourceRules(architecture)[1]).toEqual({
      name: "domain-is-pure",
      comment: "the domain must be testable without a database",
      severity: "error",
      from: { path: String.raw`^src/domain(?:/|\.)` },
      to: { path: String.raw`^src/(server|client)(?:/|\.)` },
    });
  });
});

describe("fixtureRules", () => {
  it("re-points each boundary at the fixture directory and leaves the rest identical", () => {
    const source = sourceRules(architecture);
    const fixtures = fixtureRules(architecture, "architecture-fixtures");

    // One fixture rule per boundary: no-circular needs no fixture because it
    // is not a per-package rule.
    expect(fixtures).toHaveLength(architecture.boundaries.length);
    expect(fixtures.map((rule) => rule.name)).toEqual([
      "negative-domain-is-pure",
      "negative-client-does-not-import-server-runtime",
    ]);

    for (const [index, fixture] of fixtures.entries()) {
      const real = source[index + 1];
      expect(fixture.to).toEqual(real?.to);
      expect(fixture.comment).toEqual(real?.comment);
      expect(fixture.severity).toEqual(real?.severity);
    }
    expect(fixtures[0]?.from).toEqual({
      path: "^architecture-fixtures/domain-",
    });
    expect(fixtures[1]?.from).toEqual({
      path: "^architecture-fixtures/client-",
    });
  });

  it("flattens a nested layer path into the flat fixture directory", () => {
    const nested = resolveArchitecture({
      boundaries: [
        {
          name: "amazon-is-self-contained",
          comment: "a vendor parser must not read another vendor's shape",
          from: "lib/amazon",
          to: ["lib/venmo"],
        },
      ],
    });

    expect(sourceRules(nested)[1]?.from).toEqual({
      path: String.raw`^src/lib/amazon(?:/|\.)`,
    });
    expect(fixtureRules(nested, "architecture-fixtures")[0]?.from).toEqual({
      path: "^architecture-fixtures/lib-amazon-",
    });
  });
});
