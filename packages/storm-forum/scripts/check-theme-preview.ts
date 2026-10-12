import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { themeCatalog } from "@shepherdjerred/storm-theme";

// Drive the real native chooser in a disposable local preview, never a deployed forum.
const tab = z
  .string()
  .regex(/^[A-F0-9]+$/)
  .parse(Bun.argv[2]);
const output = z.string().min(1).parse(Bun.argv[3]);
const modes =
  Bun.argv[4] === undefined
    ? (["light", "dark"] as const)
    : [z.enum(["light", "dark"]).parse(Bun.argv[4])];
const configPath = z.string().min(1).parse(Bun.env["PINCHTAB_CONFIG"]);
const browserConfig = z
  .object({
    server: z.object({
      port: z.string().regex(/^\d+$/),
      token: z.string().min(1),
    }),
  })
  .parse(await Bun.file(configPath).json());
const server = `http://127.0.0.1:${browserConfig.server.port}`;
const origin = "http://127.0.0.1:18796";
async function browserRequest(endpoint: string, body?: unknown) {
  const response = await fetch(`${server}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${browserConfig.server.token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `PinchTab failed: ${endpoint}`);
  return response;
}
async function navigate(url: string) {
  const response = await browserRequest(`/tabs/${tab}/navigate`, { url });
  return response.json();
}
async function action(body: {
  kind: "check" | "select" | "click";
  selector: string;
  value?: string;
  submit?: boolean;
}) {
  const response = await browserRequest(`/tabs/${tab}/action`, body);
  z.object({ success: z.literal(true) }).parse(await response.json());
}
async function viewport(width: number, height: number) {
  const response = await browserRequest("/emulation/viewport", {
    tabId: tab,
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  z.object({ status: z.literal("applied") }).parse(await response.json());
}
const RenderSchema = z.object({
  origin: z.literal(origin),
  nav: z.string(),
  scenery: z.string(),
  decoration: z.string(),
  overflow: z.number(),
  headerVisible: z.boolean(),
  footer: z.string(),
  errors: z.boolean(),
});
async function renderState() {
  const response = await browserRequest(`/tabs/${tab}/evaluate`, {
    expression: `({
    origin:location.origin,
    nav:getComputedStyle(document.querySelector('.p-nav')).backgroundColor,
    scenery:getComputedStyle(document.body).backgroundImage,
    decoration:getComputedStyle(document.querySelector('.stormGarland')).backgroundImage,
    overflow:document.documentElement.scrollWidth - innerWidth,
    headerVisible:document.querySelector('.flexile-headerContent').getBoundingClientRect().height > 0,
    footer:getComputedStyle(document.querySelector('.p-footer')).backgroundColor,
    errors:document.title.startsWith('Oops!') || document.body.innerText.includes('An unexpected error occurred')
  })`,
  });
  return RenderSchema.parse(
    z.object({ result: z.unknown() }).parse(await response.json()).result,
  );
}
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;
await mkdir(output, { recursive: true });
await navigate(`${origin}/`);
const initialState = await renderState();
assert.equal(initialState.origin, origin);
const assets = new Set([
  ...Object.values(themeCatalog.scenery).flatMap((scene) => [
    scene.desktop,
    scene.mobile,
  ]),
  ...themeCatalog.themes.flatMap((theme) =>
    theme.decoration === null ? [] : [theme.decoration],
  ),
  ...themeCatalog.themes.flatMap((theme) => Object.values(theme.logos)),
  "logo.svg",
]);
for (const asset of assets) {
  const response = await fetch(`${origin}/styles/storm/${asset}`);
  assert.equal(response.status, 200, `Asset failed: ${asset}`);
  await response.arrayBuffer();
}
for (const mode of modes) {
  for (const theme of themeCatalog.themes) {
    await viewport(1440, 960);
    await navigate(`${origin}/misc/style`);
    await action({
      kind: "check",
      selector: `input[name="storm_mode"][value="${mode}"]`,
    });
    await action({
      kind: "select",
      selector: 'select[name="storm_theme"]',
      value: theme.id,
    });
    await action({
      kind: "click",
      selector: 'form[action*="misc/style"] button[type="submit"]',
      submit: true,
    });
    await navigate(`${origin}/misc/style`);
    const selectionResponse = await browserRequest(`/tabs/${tab}/evaluate`, {
      expression: `({mode:document.querySelector('input[name="storm_mode"]:checked').value,
        theme:document.querySelector('select[name="storm_theme"]').value})`,
    });
    const selection = z
      .object({ result: z.object({ mode: z.string(), theme: z.string() }) })
      .parse(await selectionResponse.json()).result;
    assert.deepEqual(selection, { mode, theme: theme.id });
    await navigate(`${origin}/`);
    for (const [size, width, height] of [
      ["desktop", 1440, 960],
      ["mobile", 390, 844],
    ] as const) {
      await viewport(width, height);
      const state = await renderState();
      assert.equal(
        state.errors,
        false,
        `${mode}:${theme.id} rendered an error`,
      );
      assert.equal(
        state.nav,
        rgb(theme.palettes[mode].chromeBg),
        `${mode}:${theme.id} selection was not persisted`,
      );
      assert.ok(
        state.overflow <= 1,
        `${mode}:${theme.id} overflows on ${size}`,
      );
      assert.equal(
        state.headerVisible,
        true,
        `${mode}:${theme.id} header hidden on ${size}`,
      );
      assert.equal(state.footer, "rgb(27, 27, 27)");
      const scene = themeCatalog.scenery[theme.scenery];
      assert.ok(scene !== undefined);
      assert.ok(
        state.scenery.includes(
          size === "desktop" ? scene.desktop : scene.mobile,
        ),
      );
      if (theme.decoration !== null)
        assert.ok(state.decoration.includes(theme.decoration));
      const screenshot = await browserRequest(
        `/tabs/${tab}/screenshot?format=png&raw=true`,
      );
      await Bun.write(
        path.resolve(output, `${mode}-${theme.id}-${size}.png`),
        await screenshot.arrayBuffer(),
      );
    }
    process.stdout.write(
      `Rendered and verified ${mode}:${theme.id} on desktop and mobile\n`,
    );
  }
}
process.stdout.write(
  `${String(modes.length * themeCatalog.themes.length)} static combinations passed native selection, chooser persistence, asset, layout and header/footer checks.\n`,
);
