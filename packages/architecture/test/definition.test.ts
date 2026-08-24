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
});
