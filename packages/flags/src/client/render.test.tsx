import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { ConflictBanner } from "./conflict-banner.tsx";
import { FlagTable } from "./flag-table.tsx";
import { DeploymentPicker, DeploymentSidebar } from "./sidebar.tsx";

const noop = (): void => {
  // The static render never fires events.
};
const environment: ThemeEnvironment = {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
};
const theme = createThemeStore("flags-theme-test", environment);

const ids = ["scout/beta", "scout/prod", "golink/prod", "tracker/prod"];
const counts = new Map([
  ["scout/prod", 45],
  ["golink/prod", 3],
]);

test("the sidebar groups Beta and Prod and marks the selected deployment", () => {
  const html = renderToStaticMarkup(
    <DeploymentSidebar
      ids={ids}
      counts={counts}
      route={{ catalog: "scout", stage: "prod" }}
      theme={theme}
    />,
  );
  expect(html).toContain("Flags");
  expect(html).toContain("switch app");
  // Prod-only catalogs are plain rows; scout is its own labelled group.
  expect(html).toMatch(/>Deployments<\/p>/);
  expect(html).toMatch(/>scout<\/p>/);
  expect(html).toMatch(/>golink<\/span><span class="ui-nav-count">3</);
  expect(html).toMatch(/>Beta<\/span>/);
  expect(html).toMatch(/>Prod<\/span><span class="ui-nav-count">45</);
  // Only the selected deployment is aria-current.
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(
    /href="\/scout\/prod"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/scout\/prod"/,
  );
  expect(html).toContain("Theme");
});

const flags: FlagValue[] = [
  { type: "boolean", key: "on_flag", default: true, rollouts: [] },
  { type: "boolean", key: "off_flag", default: false, rollouts: [] },
  {
    type: "boolean",
    key: "targeted_flag",
    default: false,
    rollouts: [
      { constraints: [{ property: "user", value: "1" }], result: true },
    ],
  },
  { type: "variant", key: "budget", value: "20000000" },
];

test("the flag table shows state words, mono variant values and the selected row", () => {
  const html = renderToStaticMarkup(
    <FlagTable
      catalog="scout"
      stage="prod"
      flags={flags}
      selectedKey="off_flag"
      query="flag"
    />,
  );
  expect(html).toContain("<span>On</span>");
  expect(html).toContain("<span>Off</span>");
  expect(html).toContain("<span>Targeted</span>");
  expect(html).toContain('data-sev="ok"');
  expect(html).toContain('data-sev="unknown"');
  expect(html).toContain('data-sev="info"');
  expect(html).toMatch(/class="ui-mono fl-value"[^>]*>20000000</);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('href="/scout/prod/off_flag?q=flag"');
  expect(html).toContain('<td class="ui-muted">variant</td>');
});

test("the conflict banner shows both versions and offers theirs when it exists", () => {
  const theirs: FlagValue = {
    type: "boolean",
    key: "on_flag",
    default: false,
    rollouts: [],
  };
  const draft: FlagValue = { ...theirs, default: true };
  const html = renderToStaticMarkup(
    <ConflictBanner
      revision={7}
      theirs={theirs}
      draft={draft}
      onLoadTheirs={noop}
    />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("Revision conflict");
  expect(html).toContain("revision 7");
  expect(html).toContain("Their flag");
  expect(html).toContain("Your draft");
  expect(html).toContain("Load their version");

  const gone = renderToStaticMarkup(
    <ConflictBanner
      revision={8}
      theirs={undefined}
      draft={draft}
      onLoadTheirs={noop}
    />,
  );
  expect(gone).toContain("This flag is gone from their document.");
  expect(gone).not.toContain("Load their version");
});

test("the narrow-width picker keeps the app switcher and the deployment select", () => {
  const html = renderToStaticMarkup(
    <DeploymentPicker ids={ids} route={{ catalog: "scout", stage: "prod" }} />,
  );
  expect(html).toContain("switch app");
  expect(html).toContain("<select");
  expect(html).toContain('<option value="scout/prod" selected');
});
