import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import ts from "typescript";
import { lessonRoot } from "#lib/article.ts";

type Props = {
  children: ElementLike[];
  id?: string;
  title?: string;
  name?: string;
  onClick?: EventListener;
};
type ElementLike = {
  type: string | ((props: Props) => ElementLike);
  props: Props;
};
type LessonApi = {
  createElement: (
    type: ElementLike["type"],
    props?: Omit<Props, "children"> | null,
    ...children: (ElementLike | string | number)[]
  ) => ElementLike;
  render: (element: ElementLike, container: Node) => void;
  useState: <T>(initial: T) => [T, (action: (previous: T) => T) => void];
};
declare global {
  var lesson: LessonApi;
  var idle: IdleRequestCallback[];
  var flush: () => void;
  var clicks: string[];
}
async function mount(page: Page, name: string): Promise<void> {
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    globalThis.idle = [];
    globalThis.clicks = [];
    globalThis.requestIdleCallback = (callback) => {
      globalThis.idle.push(callback);
      return globalThis.idle.length;
    };
    globalThis.flush = () => {
      const work = globalThis.idle.shift();
      if (work === undefined) throw new Error("No work scheduled");
      work({ timeRemaining: () => 100, didTimeout: false });
    };
  });
  const source = await Bun.file(path.resolve(lessonRoot, name)).text();
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  await page.addScriptTag({
    content: `${compiled.replace(/export \{\};?/, "")}\nwindow.lesson = Didact;`,
  });
}

for (const stage of ["10.tsx", "17.tsx", "20.tsx"]) {
  test(`${stage}: completed rendering milestone runs its displayed source`, async ({
    page,
  }) => {
    await mount(page, stage);
    if (stage !== "10.tsx")
      await page.evaluate(() => {
        globalThis.flush();
      });
    await expect(page.locator("#root > div")).toHaveAttribute("id", "foo");
    await expect(page.locator("#root a")).toHaveText("bar");
    await expect(page.locator("#root b")).toHaveCount(1);
  });
}

for (const stage of ["37.tsx", "44.tsx", "50.tsx"]) {
  test(`${stage}: updates text, properties, events, and deletes adjacent children`, async ({
    page,
  }) => {
    await mount(page, stage);
    await page.evaluate(() => {
      globalThis.flush();
      const d = globalThis.lesson,
        root = globalThis.document.querySelector("#root");
      if (root === null) throw new Error("Missing root");
      d.render(
        d.createElement(
          "div",
          {
            title: "old",
            name: "named",
            onClick: () => {
              globalThis.clicks.push("old");
            },
          },
          d.createElement("b", null, "first"),
          d.createElement("b", null, "second"),
          d.createElement("i", null, "third"),
        ),
        root,
      );
      globalThis.flush();
    });
    const node = page.locator("#root > div");
    await expect(node).toHaveAttribute("name", "named");
    await node.click();
    await page.evaluate(() => {
      const d = globalThis.lesson,
        root = globalThis.document.querySelector("#root");
      if (root === null) throw new Error("Missing root");
      const previous = root.firstChild;
      d.render(
        d.createElement(
          "div",
          {
            title: "new",
            onClick: () => {
              globalThis.clicks.push("new");
            },
          },
          "updated",
        ),
        root,
      );
      globalThis.flush();
      if (root.firstChild !== previous)
        throw new Error("Same-type DOM node was replaced");
    });
    await expect(node).toHaveText("updated");
    await expect(node).toHaveAttribute("title", "new");
    await node.click();
    expect(await page.evaluate(() => globalThis.clicks)).toEqual([
      "old",
      "new",
    ]);
    await page.evaluate(() => {
      const d = globalThis.lesson,
        root = globalThis.document.querySelector("#root");
      if (root === null) throw new Error("Missing root");
      d.render(d.createElement("div", null, "no event"), root);
      globalThis.flush();
    });
    await node.click();
    expect(await page.evaluate(() => globalThis.clicks)).toEqual([
      "old",
      "new",
    ]);
    await expect(node).toHaveAttribute("title", "");
  });
}

test("44.tsx: deletes a function component's host descendant", async ({
  page,
}) => {
  await mount(page, "44.tsx");
  await page.evaluate(() => {
    globalThis.flush();
    const d = globalThis.lesson,
      root = globalThis.document.querySelector("#root");
    if (root === null) throw new Error("Missing root");
    function App(props: Props) {
      return d.createElement("span", null, props.name ?? "");
    }
    d.render(
      d.createElement("div", null, d.createElement(App, { name: "typed" })),
      root,
    );
    globalThis.flush();
    if (root.textContent !== "typed")
      throw new Error("Function component did not render");
    d.render(d.createElement("div", null), root);
    globalThis.flush();
  });
  await expect(page.locator("#root")).toHaveText("");
});

test("50.tsx: multiple hooks preserve types and apply queued updates in order", async ({
  page,
}) => {
  await mount(page, "50.tsx");
  await page.evaluate(() => {
    globalThis.flush();
    const d = globalThis.lesson,
      root = globalThis.document.querySelector("#root");
    if (root === null) throw new Error("Missing root");
    function Counter() {
      const [count, setCount] = d.useState(1),
        [label, setLabel] = d.useState("A");
      return d.createElement(
        "button",
        {
          onClick: () => {
            setCount((value) => value + 1);
            setCount((value) => value * 2);
            setLabel((value) => value + "B");
          },
        },
        label,
        ":",
        count,
      );
    }
    d.render(d.createElement(Counter, null), root);
    globalThis.flush();
  });
  await expect(page.locator("button")).toHaveText("A:1");
  await page.locator("button").click();
  await page.evaluate(() => {
    globalThis.flush();
  });
  await expect(page.locator("button")).toHaveText("AB:4");
  await page.locator("button").click();
  await page.evaluate(() => {
    globalThis.flush();
  });
  await expect(page.locator("button")).toHaveText("ABB:10");
});
