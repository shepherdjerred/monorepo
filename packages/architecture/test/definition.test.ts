import { describe, expect, it } from "vitest";
import { resolveArchitecture } from "#src/definition.ts";

const boundary = {
  name: "domain-is-pure",
  comment: "why",
  from: "domain",
  to: ["server"],
};

describe("resolveArchitecture", () => {
  it("fills in the conventional defaults", () => {
    expect(resolveArchitecture({})).toEqual({
      sourceRoot: "src",
      tsConfigFileName: "tsconfig.json",
      boundaries: [],
    });
  });

  it("accepts a well-formed boundary", () => {
    expect(resolveArchitecture({ boundaries: [boundary] }).boundaries).toEqual([
      boundary,
    ]);
  });

  it("rejects a layer name that could inject regular-expression syntax", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [{ ...boundary, from: "domain|src" }],
      }),
    ).toThrow(/from/u);
    expect(() =>
      resolveArchitecture({ boundaries: [{ ...boundary, to: ["(server)"] }] }),
    ).toThrow(/to/u);
  });

  it("rejects redefining the always-on circular rule", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [{ ...boundary, name: "no-circular" }],
      }),
    ).toThrow(/always enforced/u);
  });

  it("rejects two boundaries sharing a name", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [boundary, { ...boundary, to: ["client"] }],
      }),
    ).toThrow(/duplicate boundary name/u);
  });

  it("rejects a boundary that forbids a layer from depending on itself", () => {
    expect(() =>
      resolveArchitecture({ boundaries: [{ ...boundary, to: ["domain"] }] }),
    ).toThrow(/depending on itself/u);
  });

  it("rejects a boundary with no target layers", () => {
    expect(() =>
      resolveArchitecture({ boundaries: [{ ...boundary, to: [] }] }),
    ).toThrow();
  });

  it("rejects a boundary with a repeated target layer", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [{ ...boundary, to: ["server", "server"] }],
      }),
    ).toThrow(/repeats a target layer/u);
  });

  it("rejects a boundary with no explanation", () => {
    expect(() =>
      resolveArchitecture({ boundaries: [{ ...boundary, comment: "" }] }),
    ).toThrow();
  });

  it("accepts a nested layer path", () => {
    expect(
      resolveArchitecture({
        boundaries: [{ ...boundary, from: "lib/amazon", to: ["lib/venmo"] }],
      }).boundaries,
    ).toEqual([{ ...boundary, from: "lib/amazon", to: ["lib/venmo"] }]);
  });

  it("rejects a nested layer path with an empty segment", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [{ ...boundary, from: "lib//amazon" }],
      }),
    ).toThrow(/from/u);
  });
});

const isolatedGroup = {
  name: "vendors-are-isolated",
  comment: "a vendor parser must not read another vendor's shape",
  layers: ["lib/amazon", "lib/venmo", "lib/usaa"],
};

describe("resolveArchitecture isolated groups", () => {
  it("expands a group into one boundary per member forbidding the others", () => {
    expect(
      resolveArchitecture({ isolatedGroups: [isolatedGroup] }).boundaries,
    ).toEqual([
      {
        name: "vendors-are-isolated-lib-amazon",
        comment: isolatedGroup.comment,
        from: "lib/amazon",
        to: ["lib/venmo", "lib/usaa"],
      },
      {
        name: "vendors-are-isolated-lib-venmo",
        comment: isolatedGroup.comment,
        from: "lib/venmo",
        to: ["lib/amazon", "lib/usaa"],
      },
      {
        name: "vendors-are-isolated-lib-usaa",
        comment: isolatedGroup.comment,
        from: "lib/usaa",
        to: ["lib/amazon", "lib/venmo"],
      },
    ]);
  });

  it("rejects a group of fewer than two layers", () => {
    expect(() =>
      resolveArchitecture({
        isolatedGroups: [{ ...isolatedGroup, layers: ["lib/amazon"] }],
      }),
    ).toThrow();
  });

  it("rejects a group that repeats a layer", () => {
    expect(() =>
      resolveArchitecture({
        isolatedGroups: [
          { ...isolatedGroup, layers: ["lib/amazon", "lib/amazon"] },
        ],
      }),
    ).toThrow(/repeats a layer/u);
  });

  it("rejects a generated name that collides with a hand-written boundary", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [{ ...boundary, name: "vendors-are-isolated-lib-amazon" }],
        isolatedGroups: [isolatedGroup],
      }),
    ).toThrow(/duplicate boundary name/u);
  });

  it("rejects two layers that would share one flattened fixture prefix", () => {
    expect(() =>
      resolveArchitecture({
        boundaries: [
          { ...boundary, from: "lib/amazon", to: ["server"] },
          {
            ...boundary,
            name: "second",
            from: "lib-amazon",
            to: ["server"],
          },
        ],
      }),
    ).toThrow(/same fixture prefix/u);
  });
});
