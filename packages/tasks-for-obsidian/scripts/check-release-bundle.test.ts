import { describe, expect, it } from "vitest";
import {
  collectSourcemapSources,
  findSingletonViolations,
} from "./check-release-bundle.ts";

describe("collectSourcemapSources", () => {
  it("reads the flat shape older Metro versions wrote", () => {
    expect(
      collectSourcemapSources({
        version: 3,
        sources: ["a.js", "b.js"],
      }),
    ).toEqual(["a.js", "b.js"]);
  });

  it("walks sections of the indexed shape Metro 0.87 writes", () => {
    expect(
      collectSourcemapSources({
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: { version: 3, sources: ["a.js"] },
          },
          {
            offset: { line: 10, column: 0 },
            map: { version: 3, sources: ["b.js", "c.js"] },
          },
        ],
      }),
    ).toEqual(["a.js", "b.js", "c.js"]);
  });

  it("returns no sources when neither shape is present", () => {
    expect(collectSourcemapSources({ version: 3 })).toEqual([]);
    expect(collectSourcemapSources(null)).toEqual([]);
    expect(collectSourcemapSources("sources")).toEqual([]);
  });
});

describe("findSingletonViolations on indexed-map sources", () => {
  it("sees a singleton bundled once across sections", () => {
    expect(
      findSingletonViolations([
        "/app/node_modules/react/index.js",
        "/app/node_modules/react-native/index.js",
        "/app/node_modules/scheduler/index.js",
      ]),
    ).toEqual([]);
  });
});
