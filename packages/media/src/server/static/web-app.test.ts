import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createMediaApp } from "#server/app.ts";
import { fixture } from "#server/http.test-support.ts";
import { mountMediaClient, WEB_APP_FILE_CACHE_CONTROL } from "./client.ts";

/**
 * The installable web app, as the server answers for it: the committed
 * manifest and icons in `public/`, which Vite copies into `dist/` unchanged,
 * behind the real application. No request here carries a session, because a
 * browser fetches a manifest without cookies and the sign-in page shows the
 * same icons.
 */

const PACKAGE = path.resolve(import.meta.dirname, "../../..");
const PUBLIC = path.join(PACKAGE, "public");
const MANIFEST = "/manifest.webmanifest";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const IconSchema = z.strictObject({
  src: z.string().startsWith("/icons/"),
  sizes: z.string().regex(/^\d+x\d+$/u),
  type: z.literal("image/png"),
  purpose: z.enum(["any", "maskable"]),
});
const ManifestSchema = z.strictObject({
  id: z.literal("/"),
  name: z.literal("Media"),
  short_name: z.literal("Media"),
  description: z.string().min(1),
  lang: z.literal("en"),
  start_url: z.literal("/"),
  scope: z.literal("/"),
  display: z.literal("standalone"),
  background_color: z.string().regex(/^#[\da-f]{6}$/u),
  theme_color: z.string().regex(/^#[\da-f]{6}$/u),
  icons: z.array(IconSchema),
});

/** The production composition: the real application, then the client mount. */
function app() {
  const media = createMediaApp(fixture().dependencies);
  mountMediaClient(media, PUBLIC);
  return media;
}

async function source(file: string): Promise<string> {
  return readFile(path.join(PACKAGE, file), "utf8");
}

function capture(text: string, pattern: RegExp, what: string): string {
  const [, found] = pattern.exec(text) ?? [];
  if (found === undefined) throw new Error(`No ${what}`);
  return found;
}

/** The `href` of the one `<link>` in the shell with these attributes. */
function linked(shell: string, attributes: string): string {
  return capture(
    shell,
    new RegExp(String.raw`<link\s+${attributes}\s+href="([^"]+)"`, "u"),
    `<link ${attributes}>`,
  );
}

/** Fetches a file with no session and holds it to what every one promises. */
async function served(route: string, contentType: string) {
  const media = app();
  const response = await media.request(route);
  expect(response.status, route).toBe(200);
  expect(response.headers.get("Content-Type"), route).toBe(contentType);
  expect(response.headers.get("Cache-Control"), route).toBe(
    WEB_APP_FILE_CACHE_CONTROL,
  );
  expect(response.headers.get("ETag"), route).toMatch(/^"[\da-f]+"$/u);
  // The one policy every response carries, which lets a page load exactly
  // these: its own manifest and its own images.
  const policy = response.headers.get("Content-Security-Policy");
  const health = await media.request("/health");
  expect(policy, route).toBe(health.headers.get("Content-Security-Policy"));
  expect(policy, route).toContain("manifest-src 'self'");
  expect(policy, route).toContain("img-src 'self'");
  return response;
}

/** A PNG's pixel size, from the header every PNG starts with. */
async function pngSize(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  const header = new DataView(bytes.buffer, bytes.byteOffset, 24);
  return `${String(header.getUint32(16))}x${String(header.getUint32(20))}`;
}

async function manifest() {
  const response = await served(MANIFEST, "application/manifest+json");
  return ManifestSchema.parse(await response.json());
}

describe("installable web app", () => {
  test("the manifest is served without a session, and the API is not", async () => {
    const media = app();
    expect(WEB_APP_FILE_CACHE_CONTROL).toBe("no-cache");
    await manifest();
    const api = await media.request("/api/v1/me");
    expect(api.status).toBe(401);
  });

  test("the manifest installs Media at the root, standing alone", async () => {
    expect(await manifest()).toMatchObject({
      id: "/",
      name: "Media",
      short_name: "Media",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  test("every icon the manifest names is a PNG of the size it says", async () => {
    const { icons } = await manifest();
    expect(icons.map((icon) => `${icon.purpose} ${icon.sizes}`).sort()).toEqual(
      ["any 192x192", "any 512x512", "maskable 512x512"],
    );
    for (const icon of icons) {
      const response = await served(icon.src, icon.type);
      expect(await pngSize(response), icon.src).toBe(icon.sizes);
    }
  });

  test("the shell links the manifest, both favicons and the home-screen icon", async () => {
    const shell = await source("index.html");
    expect(linked(shell, 'rel="manifest"')).toBe(MANIFEST);

    const vector = linked(
      shell,
      String.raw`rel="icon"\s+type="image/svg\+xml"`,
    );
    const drawn = await served(vector, "image/svg+xml; charset=utf-8");
    expect(await drawn.text()).toContain("<svg");

    const bitmap = linked(
      shell,
      String.raw`rel="icon"\s+type="image/png"\s+sizes="32x32"`,
    );
    expect(await pngSize(await served(bitmap, "image/png"))).toBe("32x32");

    const touch = linked(shell, 'rel="apple-touch-icon"');
    expect(await pngSize(await served(touch, "image/png"))).toBe("180x180");
  });

  test("an unchanged file answers a conditional request with an empty 304", async () => {
    const media = app();
    for (const route of [MANIFEST, "/icons/icon-192.png"]) {
      const first = await media.request(route);
      const tag = first.headers.get("ETag");
      if (tag === null) throw new Error(`${route} has no entity tag`);
      const again = await media.request(route, {
        headers: { "If-None-Match": tag },
      });
      expect(again.status, route).toBe(304);
      expect(again.headers.get("Cache-Control"), route).toBe(
        WEB_APP_FILE_CACHE_CONTROL,
      );
      expect(await again.text(), route).toBe("");
      const stale = await media.request(route, {
        headers: { "If-None-Match": '"another-release"' },
      });
      expect(stale.status, route).toBe(200);
    }
  });

  // One Spruce: the token, the dark `theme-color` meta, the manifest's two
  // colors, and the tile of every icon.
  test("the manifest and the icons are painted the dark canvas", async () => {
    const tokens = await source("src/client/styles/tokens.css");
    const spruce = capture(
      tokens,
      /--spruce-900:\s*(#[\da-f]{6});/u,
      "--spruce-900",
    );
    expect(tokens).toMatch(
      /--canvas:\s*light-dark\(var\(--paper-100\),\s*var\(--spruce-900\)\);/u,
    );
    const shell = await source("index.html");
    expect(
      capture(
        shell,
        /media="\(prefers-color-scheme: dark\)"\s+content="([^"]+)"/u,
        "dark theme-color",
      ),
    ).toBe(spruce);

    const { background_color: background, theme_color: theme } =
      await manifest();
    expect(background).toBe(spruce);
    expect(theme).toBe(spruce);

    // Each drawing paints its tile first, and uses no color the tokens lack.
    const palette = new Set(
      ["spruce-900", "spruce-700", "mist", "lamp"].map((name) =>
        capture(
          tokens,
          new RegExp(String.raw`--${name}:\s*(#[\da-f]{6});`, "u"),
          name,
        ),
      ),
    );
    for (const icon of [
      "favicon",
      "icon",
      "icon-maskable",
      "apple-touch-icon",
    ]) {
      const drawing = await source(`public/icons/${icon}.svg`);
      const painted = [
        ...drawing.matchAll(/\s(?:fill|stroke)="(#[^"]+)"/gu),
      ].map(([, color = ""]) => color);
      expect(painted[0], icon).toBe(spruce);
      expect(
        painted.filter((color) => !palette.has(color)),
        icon,
      ).toEqual([]);
    }
  });
});
