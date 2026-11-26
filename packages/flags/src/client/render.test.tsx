// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { validateVariantValue } from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { createQueryClient } from "./api.ts";
import type { DiffViewProps, JsonEditorProps } from "./code.tsx";
import { App } from "./app.tsx";
import { ConflictBanner } from "./conflict-banner.tsx";
import { FlagTable } from "./flag-table.tsx";
import { DeploymentSidebar, FlagsTopBar } from "./sidebar.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// Monaco needs a real browser; the lazy editor and diff are stood in for by
// a textarea and two <pre> blocks with the same props.
vi.mock("./monaco/json-editor.tsx", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: JsonEditorProps) =>
      createElement("textarea", {
        className: "json-stand-in",
        "aria-label": props.label,
        "aria-invalid": props.invalid ? true : undefined,
        "aria-describedby": props.describedBy,
        "data-schema": JSON.stringify(props.schema),
        value: props.value,
        onChange: (event: { target: { value: string } }) => {
          props.onChange(event.target.value);
        },
      }),
  };
});
vi.mock("./monaco/diff-view.tsx", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: DiffViewProps) =>
      createElement(
        "div",
        { className: "diff-stand-in" },
        createElement("pre", { "data-side": "original" }, props.original),
        createElement("pre", { "data-side": "modified" }, props.modified),
      ),
  };
});

const noop = (): void => {
  // The theme store's environment never fires events here.
};

/** Static markup inside a router, which `<Link>` needs. */
function staticHtml(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}
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
  const html = staticHtml(
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
  const html = staticHtml(
    <FlagTable
      catalog="scout"
      stage="prod"
      flags={flags}
      selectedKey="off_flag"
      query="flag"
    />,
  );
  // Hub's severity badges: On is ok, Off is neutral, Targeted is info.
  expect(html).toMatch(/class="ui-badge" data-sev="ok">.*?On<\/span>/);
  expect(html).toMatch(/class="ui-badge" data-sev="unknown">.*?Off<\/span>/);
  expect(html).toMatch(/class="ui-badge" data-sev="info">.*?Targeted<\/span>/);
  expect(html).toMatch(/class="fl-value"[^>]*>20000000</);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('href="/scout/prod/off_flag?q=flag"');
  expect(html).toContain('<td class="ui-muted" data-label="Type">variant</td>');
});

test("the conflict banner shows both versions and offers theirs when it exists", () => {
  const theirs: FlagValue = {
    type: "boolean",
    key: "on_flag",
    default: false,
    rollouts: [],
  };
  const draft: FlagValue = { ...theirs, default: true };
  const html = staticHtml(
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
  expect(html).toContain("Their flag (before) against your draft (after).");
  // Until the diff chunk loads, the draft shows as plain text.
  expect(html).toContain('class="fl-code fl-code-loading"');
  expect(html).toContain("Load their version");

  const gone = staticHtml(
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

test("the narrow-width top bar keeps the app switcher, search and the menu", () => {
  const html = staticHtml(
    <FlagsTopBar
      ids={ids}
      counts={counts}
      route={{ catalog: "scout", stage: "prod" }}
      theme={theme}
    />,
  );
  expect(html).toContain("switch app");
  expect(html).toContain('aria-label="Open navigation"');
  expect(html).toContain('aria-label="Search deployments and flags"');
  expect(html).toContain("Theme: system");
});

// ---- Client-side navigation, rendered in jsdom against a stubbed API ----

const documents: Readonly<
  Record<
    string,
    {
      readonly id: string;
      readonly revision: number;
      readonly flags: readonly FlagValue[];
    }
  >
> = {
  "scout/prod": {
    id: "scout/prod",
    revision: 4,
    flags: [...flags, { type: "variant", key: "model", value: "luna" }],
  },
  "scout/beta": {
    id: "scout/beta",
    revision: 2,
    flags: [{ type: "variant", key: "budget", value: "500" }],
  },
  "golink/prod": {
    id: "golink/prod",
    revision: 9,
    flags: [{ type: "boolean", key: "debug", default: false, rollouts: [] }],
  },
  "delivery/prod": {
    id: "delivery/prod",
    revision: 12,
    flags: [
      {
        type: "variant",
        key: "delivery-enabled-environments",
        value: '["beta","prod"]',
      },
      { type: "variant", key: "delivery-executor-concurrency", value: "8" },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/**
 * Serves the deployment list and documents. Every request is recorded;
 * `hold(url)` keeps that URL's response back until the returned release runs.
 */
function stubApi(
  options: { readonly apply?: (body: unknown) => Response } = {},
) {
  const calls: string[] = [];
  const applied: unknown[] = [];
  const held = new Map<string, Promise<undefined>>();
  vi.stubGlobal(
    "fetch",
    async (input: string, init?: RequestInit): Promise<Response> => {
      calls.push(input);
      await held.get(input);
      if (input.endsWith("/apply")) {
        if (typeof init?.body !== "string")
          throw new TypeError("apply sends a JSON string body");
        const body: unknown = JSON.parse(init.body);
        applied.push(body);
        return options.apply?.(body) ?? Response.json({ revision: 99 });
      }
      if (input === "/v1/deployments") {
        return Response.json({
          deployments: Object.values(documents).map((stored) => ({
            id: stored.id,
            revision: stored.revision,
            flagCount: stored.flags.length,
          })),
        });
      }
      const id = decodeURIComponent(input.replace("/v1/deployments/", ""));
      const found = documents[id];
      return found === undefined
        ? Response.json({ error: "unknown deployment" }, { status: 404 })
        : Response.json(found);
    },
  );
  return {
    calls,
    applied,
    hold(url: string): () => Promise<void> {
      const gate = Promise.withResolvers<undefined>();
      held.set(url, gate.promise);
      return async () => {
        await act(async () => {
          gate.resolve(undefined);
          await Promise.resolve();
        });
        await settle();
      };
    },
  };
}

/** Lets fetches resolve and React Query and React commit what they bring. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

let go: NavigateFunction | undefined;

/** Shows the router's location and hands the test its `navigate`. */
function Probe() {
  const location = useLocation();
  go = useNavigate();
  return <output id="probe">{`${location.pathname}${location.search}`}</output>;
}

/** jsdom has no `matchMedia`; the top bar asks whether the sidebar shows. */
function stubNarrowViewport(): void {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: noop,
    removeEventListener: noop,
  }));
}

async function mount(entry: string) {
  stubNarrowViewport();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[entry]} useTransitions={false}>
          <App theme={theme} />
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  await settle();
  const query = (selector: string): Element => {
    const found = container.querySelector(selector);
    if (found === null) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  const input = (selector: string): HTMLInputElement => {
    const found = query(selector);
    if (!(found instanceof HTMLInputElement))
      throw new TypeError(`${selector} is not an input`);
    return found;
  };
  const select = (selector: string): HTMLSelectElement => {
    const found = query(selector);
    if (!(found instanceof HTMLSelectElement))
      throw new TypeError(`${selector} is not a select`);
    return found;
  };
  const link = (selector: string, text: string): HTMLAnchorElement => {
    const found = [
      ...container.querySelectorAll<HTMLAnchorElement>(selector),
    ].find((anchor) => anchor.textContent.includes(text));
    if (found === undefined) throw new Error(`no ${selector} link "${text}"`);
    return found;
  };
  return {
    container,
    query,
    input,
    select,
    element: (selector: string): HTMLElement => {
      const found = query(selector);
      if (!(found instanceof HTMLElement))
        throw new TypeError(`${selector} is not an element`);
      return found;
    },
    link,
    location: () => query("#probe").textContent,
    heading: () => query("h1").textContent,
  };
}

/**
 * Clicks like a user and reports whether the page kept the click: a link the
 * router handles cancels the browser's default document navigation.
 */
async function click(element: HTMLElement): Promise<boolean> {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  await act(async () => {
    element.dispatchEvent(event);
    await Promise.resolve();
  });
  await settle();
  return event.defaultPrevented;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // The prototype's setter, so React's value tracker sees a real change.
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

async function navigate(to: string): Promise<void> {
  if (go === undefined) throw new Error("the probe has not rendered");
  const navigateTo = go;
  await act(async () => {
    await navigateTo(to);
  });
  await settle();
}

function documentCalls(calls: readonly string[], id: string): number {
  return calls.filter((call) => call === `/v1/deployments/${id}`).length;
}

test("the sidebar and flag rows navigate in the page and a flag reuses its deployment's document", async () => {
  const api = stubApi();
  const page = await mount("/");
  expect(page.heading()).toBe("Deployments");
  expect(document.title).toBe("Flags");

  expect(await click(page.link("a.ui-nav-item", "golink"))).toBe(true);
  expect(page.location()).toBe("/golink/prod");
  expect(page.query(".ui-eyebrow").textContent).toBe("golink");
  expect(page.heading()).toBe("Prod");
  expect(document.title).toBe("golink/prod · Flags");
  expect(
    page.link("a.ui-nav-item", "golink").getAttribute("aria-current"),
  ).toBe("page");

  expect(await click(page.link("a.fl-key", "debug"))).toBe(true);
  expect(page.location()).toBe("/golink/prod/debug");
  expect(page.query("#flag-heading").textContent).toBe("debug");
  expect(document.title).toBe("debug · golink/prod · Flags");
  expect(page.query("a.fl-key[aria-current=page]").textContent).toBe("debug");

  // The list, the deployment and the flag came from one fetch each.
  expect(api.calls.filter((call) => call === "/v1/deployments")).toHaveLength(
    1,
  );
  expect(documentCalls(api.calls, "golink/prod")).toBe(1);
});

test("the search lives in ?q= and survives choosing a flag and going back", async () => {
  stubApi();
  const page = await mount("/scout/prod");
  const search = () => page.input('input[type="search"]');

  await type(search(), "flag ");
  expect(page.location()).toBe("/scout/prod?q=flag+");
  expect(search().value).toBe("flag ");
  expect(page.query(".ui-count").textContent).toBe("3 of 5");

  expect(await click(page.link("a.fl-key", "off_flag"))).toBe(true);
  expect(page.location()).toBe("/scout/prod/off_flag?q=flag");
  expect(search().value).toBe("flag");
  expect(page.query(".ui-count").textContent).toBe("3 of 5");

  expect(await click(page.link("a.fl-back", "All flags"))).toBe(true);
  expect(page.location()).toBe("/scout/prod?q=flag");
  expect(search().value).toBe("flag");

  await type(search(), "");
  expect(page.location()).toBe("/scout/prod");
});

test("the editor draft resets when the flag or the deployment changes", async () => {
  const api = stubApi();
  const page = await mount("/scout/beta/budget");
  const value = () => page.input(".fl-form input");
  expect(value().value).toBe("500");

  await navigate("/scout/prod/budget");
  expect(value().value).toBe("20000000");
  await type(value(), "draft");
  expect(value().value).toBe("draft");

  // Same flag key, already-loaded deployment: the editor must not keep the draft.
  await navigate("/scout/beta/budget");
  expect(value().value).toBe("500");

  await navigate("/scout/prod/budget");
  await type(value(), "draft");
  await click(page.link("a.fl-key", "model"));
  expect(value().value).toBe("luna");
  await click(page.link("a.fl-key", "budget"));
  expect(value().value).toBe("20000000");

  expect(documentCalls(api.calls, "scout/prod")).toBe(1);
  expect(documentCalls(api.calls, "scout/beta")).toBe(1);
});

test("switching deployments keeps the previous table, busy, under the new header", async () => {
  const api = stubApi();
  const page = await mount("/scout/prod/on_flag");
  const release = api.hold("/v1/deployments/golink/prod");

  await click(page.link("a.ui-nav-item", "golink"));
  expect(page.location()).toBe("/golink/prod");
  expect(page.query(".ui-eyebrow").textContent).toBe("golink");
  expect(page.heading()).toBe("Prod");
  expect(document.title).toBe("golink/prod · Flags");
  expect(page.query(".fl-revision").textContent).toBe("Loading…");
  expect(page.query(".fl-body").getAttribute("aria-busy")).toBe("true");
  expect(page.query(".fl-list").hasAttribute("inert")).toBe(true);
  // The kept rows still link to the deployment they belong to.
  expect(page.link("a.fl-key", "on_flag").getAttribute("href")).toBe(
    "/scout/prod/on_flag",
  );

  await release();
  expect(page.query(".fl-body").hasAttribute("aria-busy")).toBe(false);
  expect(page.query(".fl-revision").textContent).toBe("Revision 9");
  expect(page.link("a.fl-key", "debug").getAttribute("href")).toBe(
    "/golink/prod/debug",
  );
  expect(page.container.querySelectorAll("a.fl-key")).toHaveLength(1);
});

test("the narrow-width drawer lists the views and deployments and closes on navigating", async () => {
  stubApi();
  const page = await mount("/scout/prod");
  await click(page.element('button[aria-label="Open navigation"]'));
  const drawer = document.querySelector(".ui-drawer");
  if (drawer === null) throw new Error("the drawer did not open");
  expect(
    [...drawer.querySelectorAll(".ui-nav-label")].map((l) => l.textContent),
  ).toEqual(["Views", "Deployments", "scout"]);
  const golink = [...drawer.querySelectorAll<HTMLAnchorElement>("a")].find(
    (anchor) => anchor.textContent.includes("golink"),
  );
  if (golink === undefined) throw new Error("no golink row in the drawer");
  expect(await click(golink)).toBe(true);
  expect(page.location()).toBe("/golink/prod");
  expect(page.heading()).toBe("Prod");
  expect(document.querySelector(".ui-drawer")).toBeNull();
});

test("an encoded flag key is decoded from the route", async () => {
  stubApi();
  const page = await mount("/scout/prod");
  await navigate("/scout/prod/on%5Fflag");
  expect(page.query("#flag-heading").textContent).toBe("on_flag");
});

// ---- The editor's Form and JSON modes over one draft ----

async function typeInto(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Reflect.set(prototype, "value", value, element);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

type Page = Awaited<ReturnType<typeof mount>>;

function jsonEditor(page: Page): HTMLTextAreaElement {
  const found = page.query("textarea.json-stand-in");
  if (!(found instanceof HTMLTextAreaElement))
    throw new TypeError("the JSON editor is not a textarea");
  return found;
}

function button(page: Page, selector: string): HTMLButtonElement {
  const found = page.query(selector);
  if (!(found instanceof HTMLButtonElement))
    throw new TypeError(`${selector} is not a button`);
  return found;
}

const MODE_GROUP = '[role="radiogroup"][aria-label="Edit as"]';

function modeButton(page: Page, label: "Form" | "JSON"): HTMLButtonElement {
  const found = [
    ...page.container.querySelectorAll<HTMLButtonElement>(
      `${MODE_GROUP} [role="radio"]`,
    ),
  ].find((candidate) => candidate.textContent === label);
  if (found === undefined) throw new Error(`no ${label} mode`);
  return found;
}

function checkedMode(page: Page): string {
  return page.query(`${MODE_GROUP} [aria-checked="true"]`).textContent;
}

const review = (page: Page) => button(page, '.fl-form button[type="submit"]');
const issueText = (page: Page) => page.query(".fl-issues").textContent;

function registryMessage(
  key: "delivery-enabled-environments" | "delivery-executor-concurrency",
  raw: string,
): string {
  const validation = validateVariantValue(key, raw);
  if (validation.ok) throw new Error(`${raw} is valid for ${key}`);
  const first = validation.issues[0];
  if (first === undefined) throw new Error("no issues");
  return first.message;
}

test("a JSON-encoded variant opens in JSON mode on its pretty-printed decoded value", async () => {
  stubApi();
  const page = await mount("/delivery/prod/delivery-enabled-environments");
  expect(checkedMode(page)).toBe("JSON");
  const editor = jsonEditor(page);
  expect(editor.value).toBe('[\n  "beta",\n  "prod"\n]');
  // Monaco validates against the key's generated JSON Schema.
  expect(JSON.parse(editor.dataset["schema"] ?? "")).toMatchObject({
    type: "array",
    items: { type: "string", minLength: 1 },
  });
  expect(page.query(".fl-detail-head").textContent).toContain(
    "variant flag · json",
  );
  expect(review(page).disabled).toBe(false);
});

test("an invalid value blocks Review with the registry's message", async () => {
  stubApi();
  const page = await mount("/delivery/prod/delivery-enabled-environments");
  const editor = jsonEditor(page);

  await typeInto(editor, '["", "prod"]');
  expect(issueText(page)).toContain("/0");
  expect(issueText(page)).toContain(
    registryMessage("delivery-enabled-environments", '["","prod"]'),
  );
  expect(review(page).disabled).toBe(true);
  expect(editor.getAttribute("aria-invalid")).toBe("true");
  expect(editor.getAttribute("aria-describedby")).toBe(
    page.query(".fl-issues").id,
  );

  await typeInto(editor, '["beta",');
  expect(issueText(page)).toContain("Invalid JSON");
  expect(review(page).disabled).toBe(true);

  await typeInto(editor, '["beta"]');
  expect(issueText(page)).toBe("");
  expect(review(page).disabled).toBe(false);

  // Number encodings keep a typed number field in Form mode.
  await navigate("/delivery/prod/delivery-executor-concurrency");
  expect(checkedMode(page)).toBe("Form");
  const count = page.input(".fl-form input");
  expect(count.type).toBe("number");
  expect(count.value).toBe("8");
  await typeInto(count, "100");
  expect(issueText(page)).toContain(
    registryMessage("delivery-executor-concurrency", "100"),
  );
  expect(review(page).disabled).toBe(true);
});

/** jsdom has no modal dialogs; these open and close like the browser's, minus the top layer. */
function stubDialogs(): () => void {
  const prototype = HTMLDialogElement.prototype;
  Reflect.set(prototype, "showModal", function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  Reflect.set(prototype, "close", function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
  return () => {
    Reflect.deleteProperty(prototype, "showModal");
    Reflect.deleteProperty(prototype, "close");
  };
}

test("the server's 400 issues are shown against the value", async () => {
  onTestFinished(stubDialogs());
  const api = stubApi({
    apply: () =>
      Response.json(
        {
          error: "invalid flag values",
          issues: [
            {
              key: "delivery-enabled-environments",
              path: "/1",
              message: "environment staging is not deployed",
            },
          ],
        },
        { status: 400 },
      ),
  });
  const page = await mount("/delivery/prod/delivery-enabled-environments");
  await typeInto(jsonEditor(page), '[\n  "beta",\n  "staging"\n]');

  await click(review(page));
  const dialog = page.query("dialog.fl-dialog");
  expect(dialog.hasAttribute("open")).toBe(true);
  // The review diffs the decoded values, pretty-printed.
  expect(dialog.querySelector('[data-side="original"]')?.textContent).toBe(
    '[\n  "beta",\n  "prod"\n]',
  );
  expect(dialog.querySelector('[data-side="modified"]')?.textContent).toBe(
    '[\n  "beta",\n  "staging"\n]',
  );

  await click(button(page, 'dialog button[value="save"]'));
  expect(api.applied).toEqual([
    {
      expectedRevision: 12,
      flags: [
        {
          type: "variant",
          key: "delivery-enabled-environments",
          value: '["beta","staging"]',
        },
      ],
    },
  ]);
  expect(issueText(page)).toContain("/1");
  expect(issueText(page)).toContain("environment staging is not deployed");
  expect(page.query('.fl-form [role="alert"]').textContent).toBe(
    "The server refused this value: invalid flag values",
  );

  // The refusal describes the submitted draft; editing it clears the issues.
  await typeInto(jsonEditor(page), '["beta"]');
  expect(issueText(page)).toBe("");
});

test("Save writes nothing unless a review is open", async () => {
  onTestFinished(stubDialogs());
  const api = stubApi();
  const page = await mount("/delivery/prod/delivery-enabled-environments");
  await typeInto(jsonEditor(page), '[\n  "beta",\n  "staging"\n]');

  // The dialog is closed: a stray click on its Save button must not write.
  await click(button(page, 'dialog button[value="save"]'));
  expect(api.applied).toEqual([]);

  await click(review(page));
  await click(button(page, 'dialog button[value="save"]'));
  expect(api.applied).toHaveLength(1);
});

test("switching between Form and JSON keeps one draft, and keeps unparsed text", async () => {
  stubApi();
  const page = await mount("/scout/prod/on_flag");
  expect(checkedMode(page)).toBe("Form");
  const onByDefault = () => page.input('.fl-form input[type="checkbox"]');
  expect(onByDefault().checked).toBe(true);
  await click(onByDefault());
  expect(onByDefault().checked).toBe(false);

  await click(modeButton(page, "JSON"));
  expect(JSON.parse(jsonEditor(page).value)).toEqual({
    type: "boolean",
    key: "on_flag",
    default: false,
    rollouts: [],
  });
  // The schema fixes the key and type, so they cannot be edited.
  expect(JSON.parse(jsonEditor(page).dataset["schema"] ?? "")).toMatchObject({
    properties: { type: { const: "boolean" }, key: { const: "on_flag" } },
    additionalProperties: false,
  });

  await typeInto(
    jsonEditor(page),
    JSON.stringify({
      type: "boolean",
      key: "on_flag",
      default: true,
      rollouts: [
        { constraints: [{ property: "user", value: "7" }], result: false },
      ],
    }),
  );
  await click(modeButton(page, "Form"));
  expect(onByDefault().checked).toBe(true);
  expect(page.input(".fl-constraint input").value).toBe("user");

  // A renamed key is refused; the draft keeps its last good value.
  await click(modeButton(page, "JSON"));
  await typeInto(
    jsonEditor(page),
    JSON.stringify({
      type: "boolean",
      key: "other",
      default: false,
      rollouts: [],
    }),
  );
  expect(issueText(page)).toContain("/key");
  expect(review(page).disabled).toBe(true);

  await typeInto(jsonEditor(page), "{");
  expect(review(page).disabled).toBe(true);
  await click(modeButton(page, "Form"));
  expect(review(page).disabled).toBe(false);
  expect(onByDefault().checked).toBe(true);
  await click(modeButton(page, "JSON"));
  expect(jsonEditor(page).value).toBe("{");

  // A form edit rebuilds the JSON text from the draft.
  await click(modeButton(page, "Form"));
  await click(onByDefault());
  await click(modeButton(page, "JSON"));
  expect(JSON.parse(jsonEditor(page).value)).toMatchObject({ default: false });
});

test("an unmanaged variant is shown as plain text with a notice", async () => {
  stubApi();
  const page = await mount("/scout/prod/model");
  expect(page.query('[role="note"]').textContent).toContain(
    "The server rejects writes to unmanaged keys.",
  );
  expect(page.input(".fl-form input").value).toBe("luna");
  await click(modeButton(page, "JSON"));
  expect(jsonEditor(page).value).toBe('"luna"');
  await typeInto(jsonEditor(page), "42");
  expect(issueText(page)).toContain("Expected a JSON string");
});
