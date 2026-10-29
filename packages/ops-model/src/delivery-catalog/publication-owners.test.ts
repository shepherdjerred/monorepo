import { expect, test } from "vitest";
import { publicationOwners } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";

test.each(["v1", "v2"] as const)(
  "%s retains one media chart and application image owner",
  (registry) => {
    const owners = publicationOwners(registry);
    expect(owners.image("media")).toBe("streambot");
    expect(owners.image("streambot")).toBe("streambot");
    expect(owners.chart("media")).toBe("streambot");
  },
);

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
  expect(owners.imageActive("discord-plays-mario-kart")).toBe(false);
  expect(owners.imageActive("discord-plays-pokemon")).toBe(false);
  expect(owners.imageActive("arcade")).toBe(true);
  expect(owners.chart("mario-kart")).toBeUndefined();
  expect(owners.owns("discord-plays-mario-kart")).toBe(false);
  expect(() => owners.chart("not-a-chart")).toThrow(
    "first-party catalog owner",
  );
});
