import type { AstroIntegrationLogger } from "astro";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { expect, test } from "vitest";
import { buildDoneHook } from "./hook.ts";
import { astroOpenGraphImages } from "./integration.ts";
import type {
  FilterFunction,
  IntegrationOptions,
  PathFilterFunction,
  RenderFunction,
} from "./types.ts";

class TestLogger implements AstroIntegrationLogger {
  readonly options = {
    destination: {
      write: (message: unknown) => {
        void message;
      },
    },
    level: "silent" as const,
  };
  readonly label = "test";

  fork(_label: string): TestLogger {
    return new TestLogger();
  }

  info(message: string): void {
    void message;
  }

  warn(message: string): void {
    void message;
  }

  error(message: string): void {
    void message;
  }

  debug(message: string): void {
    void message;
  }

  flush(): void {
    void this.label;
  }

  close(): void {
    void this.label;
  }
}

test("an async path filter skips a page before reading its output", async () => {
  const outputDir = await createTempDir();
  let pathFilterCalls = 0;
  let filterCalls = 0;
  let renderCalls = 0;

  const pathFilter: PathFilterFunction = async ({ pathname }) => {
    pathFilterCalls += 1;
    await Promise.resolve();
    return pathname !== "/excluded/";
  };
  const filter: FilterFunction = ({ pathname }) => {
    filterCalls += 1;
    return pathname !== "/excluded/";
  };
  const render: RenderFunction = () => {
    renderCalls += 1;
    return null;
  };
  const integration = astroOpenGraphImages({
    options: { fonts: testOptions.fonts },
    render,
    filter,
    pathFilter,
  });
  const hook = integration.hooks["astro:build:done"];

  if (hook === undefined) {
    throw new Error("Expected astro:build:done hook");
  }

  try {
    await expect(
      hook({
        pages: [{ pathname: "/excluded/" }],
        dir: pathToFileURL(`${outputDir}/`),
        assets: new Map(),
        logger: new TestLogger(),
      }),
    ).resolves.toBeUndefined();
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }

  expect(pathFilterCalls).toBe(1);
  expect(filterCalls).toBe(0);
  expect(renderCalls).toBe(0);
});

test("a path-filtered-in page still requires Open Graph metadata", async () => {
  const outputDir = await createOutputDir("accepted", "<html></html>");
  let filterCalls = 0;
  const pathFilter = alwaysPathFilter;
  const filter: FilterFunction = () => {
    filterCalls += 1;
    return true;
  };
  const render = emptyRender;

  try {
    await expect(
      buildDoneHook({
        pages: [{ pathname: "/accepted/" }],
        dir: pathToFileURL(`${outputDir}/`),
        assets: new Map(),
        logger: new TestLogger(),
        options: testOptions,
        render,
        filter,
        pathFilter,
      }),
    ).rejects.toThrow("Missing required meta tags");
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }

  expect(filterCalls).toBe(0);
});

test("an accepted page with Open Graph metadata renders an image", async () => {
  const outputDir = await createOutputDir(
    "rendered",
    `<!doctype html>
      <html>
        <head>
          <meta property="og:title" content="Rendered page" />
          <meta property="og:url" content="http://example.com/rendered/" />
          <meta property="og:type" content="website" />
          <meta property="og:image" content="http://example.com/rendered/index.png" />
        </head>
      </html>`,
  );
  let filterCalls = 0;
  let renderCalls = 0;
  const pathFilter = alwaysPathFilter;
  const filter: FilterFunction = ({ pathname }) => {
    filterCalls += 1;
    return pathname === "/rendered/";
  };
  const render: RenderFunction = () => {
    renderCalls += 1;
    return createElement("div");
  };

  try {
    await expect(
      buildDoneHook({
        pages: [{ pathname: "/rendered/" }],
        dir: pathToFileURL(`${outputDir}/`),
        assets: new Map(),
        logger: new TestLogger(),
        options: testOptions,
        render,
        filter,
        pathFilter,
      }),
    ).resolves.toBeUndefined();
    await access(path.join(outputDir, "rendered", "index.png"));
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }

  expect(filterCalls).toBe(1);
  expect(renderCalls).toBe(1);
});

test("the metadata-aware filter can skip a valid page", async () => {
  const outputDir = await createOutputDir(
    "metadata-skipped",
    renderedPageHtml("metadata-skipped"),
  );
  let filterCalls = 0;
  let renderCalls = 0;
  const pathFilter = alwaysPathFilter;
  const filter: FilterFunction = ({ title }) => {
    filterCalls += 1;
    expect(title).toBe("Rendered page");
    return false;
  };
  const render: RenderFunction = () => {
    renderCalls += 1;
    return createElement("div");
  };

  try {
    await expect(
      buildDoneHook({
        pages: [{ pathname: "/metadata-skipped/" }],
        dir: pathToFileURL(`${outputDir}/`),
        assets: new Map(),
        logger: new TestLogger(),
        options: testOptions,
        render,
        filter,
        pathFilter,
      }),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(outputDir, "metadata-skipped", "index.png")),
    ).rejects.toThrow();
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }

  expect(filterCalls).toBe(1);
  expect(renderCalls).toBe(0);
});

const testOptions: IntegrationOptions = {
  width: 1200,
  height: 630,
  verbose: false,
  fonts: [
    {
      data: await readFile(
        path.join(
          import.meta.dirname,
          "../node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff",
        ),
      ),
      name: "Roboto",
      weight: 400,
    },
  ],
};

const alwaysPathFilter: PathFilterFunction = () => true;
const emptyRender: RenderFunction = () => null;

async function createOutputDir(
  page: string,
  html = renderedPageHtml(page),
): Promise<string> {
  const outputDir = await createTempDir();
  await mkdir(path.join(outputDir, page), { recursive: true });
  await writeFile(path.join(outputDir, page, "index.html"), html);
  return outputDir;
}

async function createTempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "astro-opengraph-images-"));
}

function renderedPageHtml(page: string): string {
  return `<!doctype html>
    <html>
      <head>
        <meta property="og:title" content="Rendered page" />
        <meta property="og:url" content="http://example.com/${page}/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="http://example.com/${page}/index.png" />
      </head>
    </html>`;
}
