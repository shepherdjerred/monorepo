import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildSite, fontSource } from "#scripts/build.ts";
import { startPreview } from "#scripts/preview.ts";

let temporary: string;
let output: URL;
let server: Awaited<ReturnType<typeof startPreview>>;

beforeAll(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "statically-typed-"));
  output = pathToFileURL(`${temporary}/dist/`);
  await buildSite(output);
  server = await startPreview(output, 0);
});

afterAll(async () => {
  await server.stop(true);
  await rm(temporary, { recursive: true, force: true });
});

test("serves the built anchor page and its CSS", async () => {
  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("<h1>Statically Typed</h1>");
  expect(html).toContain("</html>");
  expect(html).not.toContain("<script");
  const stylesheet = await fetch(new URL("/styles.css", server.url));
  expect(stylesheet.status).toBe(200);
  expect(stylesheet.headers.get("content-type")).toContain("text/css");
  expect(await stylesheet.text()).toContain(
    "/fonts/BerkeleyMono-Regular.woff2",
  );
});

test("serves the actual font with a font MIME type", async () => {
  const response = await fetch(
    new URL("/fonts/BerkeleyMono-Regular.woff2", server.url),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("font/woff2");
  const bytes = await response.arrayBuffer();
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("wOF2");
  expect(bytes).toEqual(await Bun.file(fontSource).arrayBuffer());
});

test("missing pages and assets retain HTTP 404", async () => {
  for (const route of ["/missing/", "/missing.css", "/fonts/missing.woff2"]) {
    const response = await fetch(new URL(route, server.url));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("<h1>404</h1>");
  }
});

test("HEAD returns headers without a body and POST is rejected", async () => {
  const head = await fetch(server.url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  const post = await fetch(server.url, { method: "POST" });
  expect(post.status).toBe(405);
});

test("a missing or corrupt font fails the build without replacing output", async () => {
  await expect(
    buildSite(output, pathToFileURL(path.join(temporary, "missing.woff2"))),
  ).rejects.toThrow();
  const corrupt = pathToFileURL(path.join(temporary, "corrupt.woff2"));
  await Bun.write(corrupt, "not a font");
  await expect(buildSite(output, corrupt)).rejects.toThrow("complete WOFF2");
  expect(await Bun.file(new URL("index.html", output)).text()).toContain(
    "<h1>Statically Typed</h1>",
  );
});

test("preview observes replaced output instead of truncating it to the old length", async () => {
  const index = new URL("index.html", output);
  const original = await Bun.file(index).text();
  const rebuilt = original.replace("</main>", "<p>Rebuilt output</p></main>");
  try {
    await rm(index);
    await Bun.write(index, rebuilt);
    const response = await fetch(server.url);
    expect(await response.text()).toBe(rebuilt);
  } finally {
    await buildSite(output);
  }
});
