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
      allowTypeOnlyImports: true,
    },
  ],
});

describe("sourceRules", () => {
  it("always enforces no-circular, ignoring cycles closed by a type-only import", () => {
    const [circular] = sourceRules(architecture);
    expect(circular?.name).toBe("no-circular");
    expect(circular?.to).toEqual({
      circular: true,
      viaOnly: { dependencyTypesNot: ["type-only"] },
    });
  });

  it("scopes each boundary to a directory under the source root", () => {
    expect(sourceRules(architecture)[1]).toEqual({
      name: "domain-is-pure",
      comment: "the domain must be testable without a database",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { path: "^src/(server|client)/" },
    });
  });

  it("exempts type-only imports only where the boundary asks for it", () => {
    expect(sourceRules(architecture)[2]?.to).toEqual({
      path: "^src/(server)/",
      dependencyTypesNot: ["type-only"],
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
});
