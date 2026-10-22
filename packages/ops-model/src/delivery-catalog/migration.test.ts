import { describe, expect, test } from "vitest";
import {
  V1_COMPONENT_RENAMES,
  catalogComponentOf,
  catalogOwnerOf,
} from "./migration.ts";

describe("v1 component migration (section 7)", () => {
  test("renames each site archive and keeps every other component", () => {
    expect(catalogComponentOf("site:sjer-red")).toBe("archive:sjer-red");
    expect(catalogComponentOf("site:scout-frontend")).toBe(
      "archive:scout-frontend",
    );
    expect(catalogComponentOf("chart:redlib")).toBe("chart:redlib");
    const targets = Object.values(V1_COMPONENT_RENAMES);
    expect(new Set(targets).size).toBe(targets.length);
    expect(
      Object.keys(V1_COMPONENT_RENAMES).every((name) =>
        name.startsWith("site:"),
      ),
    ).toBe(true);
  });

  test("a declared component is owned by its service, a reference by its source", () => {
    const prometheus = { id: "prometheus" };
    expect(
      catalogOwnerOf(prometheus, {
        name: "chart:prometheus-companion",
        producer: "first-party",
      }),
    ).toEqual({
      serviceId: "prometheus",
      component: "chart:prometheus-companion",
    });
    expect(
      catalogOwnerOf(prometheus, {
        name: "image:caddy-s3proxy",
        producer: "reference",
        source: {
          service: "static-site-proxy",
          component: "image:caddy-s3proxy",
          mode: "pinned",
        },
      }),
    ).toEqual({
      serviceId: "static-site-proxy",
      component: "image:caddy-s3proxy",
    });
  });
});
