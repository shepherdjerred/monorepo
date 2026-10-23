import { expect, test } from "vitest";
import { publicationOwners } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";

test("v1 names services.json groups until the window's catalog flip", () => {
  const owners = publicationOwners("v1");
  expect(owners.chart("woodpecker")).toBe("ci");
  expect(owners.chart("apps")).toBe("gitops");
  expect(owners.image("woodpecker-config-extension")).toBe("ci");
  expect(owners.owns("static-sites")).toBe(true);
  expect(owners.owns("sjer-red")).toBe(false);
  expect(() => owners.chart("not-a-chart")).toThrow("service catalog owner");
});

test("v2 names the catalog's first-party owners and no longer registers apps", () => {
  const owners = publicationOwners("v2");
  expect(owners.chart("woodpecker")).toBe("woodpecker");
  expect(owners.chart("chartmuseum-companion")).toBe("chartmuseum");
  expect(owners.chart("storm-forum-beta")).toBe("storm-forum");
  expect(owners.chart("apps")).toBeUndefined();
  expect(owners.image("woodpecker-config-extension")).toBe("woodpecker");
  expect(owners.owns("sjer-red")).toBe(true);
  expect(owners.owns("tofu-cloudflare")).toBe(true);
  expect(() => owners.chart("not-a-chart")).toThrow(
    "first-party catalog owner",
  );
});
