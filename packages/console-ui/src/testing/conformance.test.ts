import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  checkConformance,
  scanIndexHtml,
  scanModule,
  scanStylesheet,
} from "@shepherdjerred/console-ui/testing/conformance.ts";

describe("scanStylesheet", () => {
  test("counts colour literals, token redefinitions and stray fonts", () => {
    const found = scanStylesheet(`
      :root { --ui-bg: #fff; --app-tint: rgb(0 0 0 / 0.1); }
      .app-title { font-family: Georgia, serif; color: white; }
      .app-mono { font: 12px var(--ui-font-mono); background: var(--ui-panel); }
      .app-quote::before { content: "#abc"; }
    `);
    expect(Object.fromEntries(found)).toEqual({
      "colour-literal": 3,
      "token-redefinition": 1,
      "font-family": 1,
    });
  });

  test("flags rules whose subject is a shared class, not ones scoped by it", () => {
    const found = scanStylesheet(`
      .ui-nav-item { height: 26px; }
      .app .ui-table tbody th, .ui-header:not(.app-x) { padding: 0; }
      .ui-table .app-cell, .app:has(.ui-btn) { padding: 0; }
      @media (width <= 600px) { .ui-header { flex-wrap: wrap; } }
    `);
    expect(found.get("shared-class-patch")).toBe(4);
  });

  test("flags local copies of shared pieces", () => {
    const found = scanStylesheet(`
      .topbar, .nav-drawer { display: flex; }
      .er-dialog-head, .mail-banner, .fd-picker, .er-empty-state { gap: 0; }
      .ch-mobile-bar .button { gap: 0; }
      .app-dialogue, .statement, .ui-banner { gap: 0; }
    `);
    expect(found.get("local-copy")).toBe(8);
  });

  test("ignores keyframe steps and at-rule preludes", () => {
    const found = scanStylesheet(`
      @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
      @layer app { .app-x { color: var(--ui-ink); } }
    `);
    expect(found.size).toBe(0);
  });
});

describe("scanModule", () => {
  test("counts inline type, deprecated imports, props, classes and theme keys", () => {
    const source = `
      import { Card, type TagProps, Button, PageBody as Body } from "@shepherdjerred/console-ui";
      import { Tag } from "./local-tag.tsx";
      const theme = createThemeStore("golink-theme");
      const shared = createThemeStore();
      const fake = createThemeStore(undefined, environment);
      const named = createThemeStore("ops-theme", environment);
      export const x = <Button size="page" style={{ fontSize: 12, fontWeight: 600 }}>
        <table className="ui-data"><tbody className="ui-table" /></table>
      </Button>;
    `;
    expect(Object.fromEntries(scanModule(source, true))).toEqual({
      "inline-typography": 2,
      "deprecated-import": 2,
      "deprecated-prop": 1,
      "deprecated-class": 1,
      "theme-store-key": 1,
    });
  });

  test("ignores inline typography outside TSX", () => {
    expect(scanModule("const axis = { fontSize: 11 };", false).size).toBe(0);
  });
});

describe("scanIndexHtml", () => {
  test("wants light and dark theme-color metas equal to the bg token", () => {
    expect(
      scanIndexHtml(`
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ecede6" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111210" />`),
    ).toBe(0);
    expect(scanIndexHtml('<meta name="theme-color" content="#f5f5f4" />')).toBe(
      3,
    );
  });
});

describe("checkConformance", () => {
  const root = path.join(import.meta.dirname, "fixtures", "app");
  const fixture = path.join(root, "client");

  test("passes when the allowlist matches exactly", async () => {
    expect(
      await checkConformance(
        fixture,
        [
          {
            rule: "colour-literal",
            file: "client/styles.css",
            count: 1,
            reason: "x",
          },
          { rule: "theme-color", file: "index.html", count: 2, reason: "x" },
        ],
        { root },
      ),
    ).toEqual([]);
  });

  test("fails when a count rises, falls or a stale entry remains", async () => {
    const problems = await checkConformance(
      fixture,
      [
        {
          rule: "colour-literal",
          file: "client/styles.css",
          count: 2,
          reason: "x",
        },
        { rule: "local-copy", file: "client/styles.css", count: 1, reason: "" },
        { rule: "made-up", file: "client/app.tsx", count: 1, reason: "x" },
      ],
      { root },
    );
    expect(problems).toEqual([
      "client/styles.css local-copy: give a reason.",
      'Unknown rule "made-up" for client/app.tsx.',
      "client/styles.css: 1 × colour-literal, allowlist has 2. Lower the allowlist entry to 1.",
      "index.html: 2 × theme-color, allowlist has 0. index.html has light and dark `theme-color` metas equal to the `bg` token.",
      "client/styles.css: no local-copy left; remove the allowlist entry.",
      "client/app.tsx: no made-up left; remove the allowlist entry.",
    ]);
  });
});
