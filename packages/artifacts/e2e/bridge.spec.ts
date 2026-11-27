/**
 * The injected bridge against the host side of the protocol: a sandboxed
 * iframe (opaque origin, no allow-same-origin) says hello, receives a port and
 * speaks only messages that `parseFrameMessage` accepts.
 */
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  parseFrameMessage,
  type FrameMessage,
} from "#client/viewers/bridge-protocol.ts";
import { BRIDGE_HOST_SCRIPT } from "./bridge-host.ts";
import { createApiClient } from "./client.ts";
import { generateFixtures, type Fixture } from "./fixtures.ts";
import { publishFixture } from "./seed.ts";

/** Publishes the fixture, frames it on the app origin and completes the handshake. */
async function hostFixture(
  page: Page,
  app: string,
  fixture: Fixture,
): Promise<void> {
  const committed = await publishFixture(app, {
    board: "bridge",
    title: fixture.title,
    files: fixture.files,
    entryPath: fixture.entryPath,
  });
  const version = await createApiClient(app).versions.get.query({
    id: committed.versionId,
  });
  await page.addInitScript(BRIDGE_HOST_SCRIPT);
  await page.goto("/readyz");
  await page.evaluate(`hostFrame(${JSON.stringify(version.contentUrl)})`);
}

/** Every port message so far; each one must be valid under the protocol. */
async function received(page: Page): Promise<FrameMessage[]> {
  const raw = z.array(z.unknown()).parse(await page.evaluate("window.hosted"));
  const parsed = raw.map((entry) => parseFrameMessage(entry));
  expect(parsed.every((entry) => entry !== null)).toBe(true);
  return parsed.filter((entry) => entry !== null);
}

function lastOf(
  messages: readonly FrameMessage[],
  type: FrameMessage["t"],
): FrameMessage | undefined {
  return messages.findLast((message) => message.t === type);
}

function contentFrame(page: Page) {
  const child = page.frames().find((frame) => frame.url().includes("/_t/"));
  if (child === undefined) throw new Error("the content frame did not load");
  return child;
}

test("the bridge handshakes, reports size and scroll, and answers probes", async ({
  page,
  baseURL,
}) => {
  const fixtures = await generateFixtures();
  await hostFixture(page, String(baseURL), fixtures.htmlV2);

  await expect
    .poll(async () => lastOf(await received(page), "drawn"))
    .toMatchObject({ t: "drawn" });
  const drawn = lastOf(await received(page), "drawn");
  expect(drawn?.t === "drawn" ? drawn.docH : 0).toBeGreaterThanOrEqual(3000);

  await contentFrame(page).evaluate("window.scrollTo(0, 500)");
  await expect
    .poll(async () => lastOf(await received(page), "scroll"))
    .toMatchObject({ t: "scroll", y: 500 });

  await page.evaluate(
    'hostPort.postMessage({ ab: 1, t: "probe", id: 7, x: 10, y: 20 })',
  );
  await expect
    .poll(async () => lastOf(await received(page), "point"))
    .toMatchObject({
      t: "point",
      id: 7,
      docX: 10,
      docY: 520,
    });

  await page.mouse.click(400, 300);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  const keys = async (): Promise<string[]> => {
    const messages = await received(page);
    return messages.flatMap((message) =>
      message.t === "key" ? [message.k] : [],
    );
  };
  await expect.poll(keys).toEqual(["Escape", "c"]);
});

test("the bridge reports in-frame navigation by path", async ({
  page,
  baseURL,
}) => {
  const fixtures = await generateFixtures();
  await hostFixture(page, String(baseURL), fixtures.site);
  const child = contentFrame(page);
  await expect(child.locator("#status")).toHaveText("app.js loaded");
  await child.getByRole("link", { name: "About this site" }).click();
  await expect
    .poll(async () => lastOf(await received(page), "nav"))
    .toMatchObject({
      t: "nav",
      path: expect.stringMatching(/\/_t\/[^/]+\/about\.html$/u),
    });
});
