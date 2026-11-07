import { describe, expect, it } from "vitest";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import {
  argocdApplicationLink,
  bugsinkLink,
  grafanaDashboardLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import { DeliveryError } from "#domain/error.ts";
import { serviceSummary } from "./views.ts";

describe("service summary", () => {
  it("keeps a v1 service's ops-model title, kind and links", () => {
    expect(serviceSummary("scout-for-lol")).toEqual({
      id: "scout-for-lol",
      title: "Scout for LoL",
      kind: "product",
      links: [
        argocdApplicationLink("scout-beta"),
        argocdApplicationLink("scout-prod"),
        grafanaDashboardLink("scout-for-lol-durable"),
        bugsinkLink(),
      ],
    });
  });

  it("reads a v2-only service's own ops attributes", () => {
    expect(serviceSummary("static-site-proxy")).toEqual({
      id: "static-site-proxy",
      title: "Static site proxy",
      kind: "product",
      links: [
        argocdApplicationLink("s3-static-sites"),
        grafanaDashboardLink("static-site-probes"),
      ],
    });
    expect(serviceSummary("webring")).toEqual({
      id: "webring",
      title: "Webring",
      kind: "product",
      links: [],
    });
  });

  it("takes the group's kind for a v2-only service without ops attributes", () => {
    expect(serviceSummary("tofu-github")).toEqual({
      id: "tofu-github",
      title: "OpenTofu github stack",
      kind: "platform",
      links: [],
    });
  });

  it("rejects a service neither model declares", () => {
    expect(() => serviceSummary("no-such-service")).toThrow(DeliveryError);
  });

  it("fails loudly when a catalog service names an unknown group", () => {
    expect(() =>
      serviceSummary("tofu-github", { ...CATALOG_CORE, groups: [] }),
    ).toThrow("Catalog service tofu-github names unknown group gitops");
  });
});
