import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createConsoleQueryClient } from "./query.ts";
import { consoleRouterLink, zodSearch } from "./router.tsx";
import { createTestQueryClient, renderWithRouter } from "./testing.tsx";

describe("createConsoleQueryClient", () => {
  it("applies the console defaults and lets a caller override them", () => {
    const client = createConsoleQueryClient();
    expect(client.getDefaultOptions().queries).toMatchObject({
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    });
    expect(createTestQueryClient().getDefaultOptions().queries).toMatchObject({
      retry: false,
      refetchOnWindowFocus: true,
    });
  });
});

describe("consoleRouterLink", () => {
  const renderLink = consoleRouterLink();
  const link = (href: string, current?: "page") =>
    renderLink({
      href,
      className: "ui-nav-item",
      "aria-current": current,
      children: href,
    });

  it("marks the active route's link current and leaves others alone", () => {
    const html = renderWithRouter(
      <nav>
        {link("/links")}
        {link("/shortcuts")}
      </nav>,
      { url: "/links" },
    );
    expect(html).toContain(
      '<a class="ui-nav-item" href="/links" data-status="active" aria-current="page">/links</a>',
    );
    expect(html).toContain(
      '<a class="ui-nav-item" href="/shortcuts">/shortcuts</a>',
    );
  });

  it("treats children as active unless the link is exact", () => {
    const parent = renderWithRouter(link("/deployments"), {
      url: "/deployments/42",
    });
    expect(parent).toContain('aria-current="page"');
    const exact = consoleRouterLink({ exact: true });
    const html = renderWithRouter(
      exact({
        href: "/deployments",
        className: "x",
        "aria-current": undefined,
        children: "Deployments",
      }),
      { url: "/deployments/42" },
    );
    expect(html).not.toContain("aria-current");
  });

  it("keeps an item console-ui marked current", () => {
    expect(renderWithRouter(link("/elsewhere", "page"))).toContain(
      'aria-current="page"',
    );
  });
});

describe("zodSearch", () => {
  const validate = zodSearch({
    missing: z.string().min(1),
    page: z.coerce.number().int().positive(),
  });

  it("keeps valid keys, drops invalid and unknown ones", () => {
    expect(validate({ missing: "docs", page: "2", extra: "x" })).toEqual({
      missing: "docs",
      page: 2,
    });
    expect(validate({ missing: "", page: "3" })).toEqual({ page: 3 });
    expect(validate({ page: "-1" })).toEqual({});
  });
});
