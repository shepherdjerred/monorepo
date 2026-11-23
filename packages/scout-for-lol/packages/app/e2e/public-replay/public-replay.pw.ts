import { expect, test, type Page, type Request } from "@playwright/test";
import type { ReplayRenderPackageManifest } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { replayFixture } from "#src/lib/replay/replay-fixture.ts";

const gameBuild = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const replayPath = `/app/replays/${replayFixture.replayId}`;
const apiPath = `/api/replays/${replayFixture.replayId}`;
const contentPath = `${apiPath}/content`;
const enginePath = "fixture-engine.mjs";
const workerPath = "fixture-worker.mjs";

const engine = await Bun.file(new URL(enginePath, import.meta.url)).text();
const worker = `self.onmessage = ({data}) => {
  self.postMessage(new TextDecoder().decode(new Uint8Array(data, 0, 4)));
};`;
// Minimal synthetic ROFL header for the public loader's identity check.
const header = Buffer.alloc(64);
header.write("RIOT");
header.writeUInt16LE(2, 4);
Buffer.from(protocol, "hex").copy(header, 6);
header[14] = gameBuild.length;
header.write(gameBuild, 15);

function sha256(bytes: string | Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function resource(path: string, body: string) {
  return { path, bytes: Buffer.byteLength(body), sha256: sha256(body) };
}

const manifest = JSON.stringify({
  schemaVersion: 1,
  gameBuild,
  protocol,
  entrypoint: enginePath,
  capabilities: {
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    rosterCoverage: "all-legal-lineups-and-skins",
    rosterInventorySha256: sha256("synthetic fixture inventory"),
  },
  files: [resource(enginePath, engine), resource(workerPath, worker)],
} satisfies ReplayRenderPackageManifest);
const manifestSha256 = sha256(manifest);
const packageRoot = `/replay-assets/${gameBuild}/${manifestSha256}`;
const manifestPath = `${packageRoot}/manifest.json`;
const resourcePath = `${packageRoot}/${workerPath}`;

type FixtureStatus =
  "preparing" | "available" | "corrupt replay" | "corrupt worker";

async function mockPublicReplay(
  page: Page,
  origin: string | undefined,
  status: FixtureStatus,
) {
  if (origin === undefined)
    throw new Error("The fixture requires a loopback base URL");
  const requested: string[] = [];
  const credentialed: string[] = [];
  async function observeRequest(pathname: string, request: Request) {
    if (
      pathname.startsWith(apiPath) ||
      pathname.startsWith("/replay-assets/")
    ) {
      const headers = await request.allHeaders();
      requested.push(pathname);
      if ("cookie" in headers || "authorization" in headers)
        credentialed.push(pathname);
    }
  }
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === replayPath && request.isNavigationRequest()) {
      return route.fulfill({
        response: await route.fetch(),
        // The production policy allows same-origin module imports and Blob workers.
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy":
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:",
        },
      });
    }
    const { pathname } = url;
    await observeRequest(pathname, request);
    switch (pathname) {
      case "/api/version":
        return route.fulfill({
          json: { version: "0.0.1", gitSha: "fixture", contractHash: "dev" },
        });
      case "/trpc/auth.sessionState":
        return route.fulfill({ json: [{ result: { data: { user: null } } }] });
      case apiPath:
        return route.fulfill({
          json: {
            ...replayFixture,
            gameBuild,
            protocol,
            durationSeconds: 60,
            bytes: header.byteLength,
            sha256: sha256(header),
            playback:
              status === "preparing"
                ? { ...replayFixture.playback, latestPatch: "16.23" }
                : {
                    status: "available",
                    latestPatch: "16.23",
                    package: { url: manifestPath, sha256: manifestSha256 },
                  },
          },
        });
      case `${apiPath}/timeline`:
        return route.fulfill({ json: { timeline: null } });
      case contentPath: {
        const body = Buffer.from(header);
        if (status === "corrupt replay") body[body.byteLength - 1] = 1;
        return route.fulfill({
          contentType: "application/vnd.riot.rofl",
          body,
        });
      }
      case manifestPath:
        return route.fulfill({
          contentType: "application/json",
          body: manifest,
        });
      case `${packageRoot}/${enginePath}`:
        return route.fulfill({ contentType: "text/javascript", body: engine });
      case resourcePath:
        return route.fulfill({
          contentType: "text/javascript",
          body:
            status === "corrupt worker"
              ? worker.replace("postMessage", "lostMessage")
              : worker,
        });
      default:
        return pathname.startsWith("/api/") || pathname.startsWith("/trpc/")
          ? route.fulfill({ status: 404 })
          : route.continue();
    }
  });
  return { requested, credentialed };
}

test("signed-out replay metadata does not fetch rendering resources while preparing", async ({
  baseURL,
  page,
}) => {
  const { requested, credentialed } = await mockPublicReplay(
    page,
    baseURL,
    "preparing",
  );
  await page.goto(replayPath);
  await expect(
    page.getByRole("heading", { name: "Replay playback is being prepared" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Replay player" })).toHaveCount(
    0,
  );
  await expect.poll(() => requested).toEqual([apiPath, `${apiPath}/timeline`]);
  expect(credentialed).toEqual([]);
});

test("signed-out playback loads the verified package and restores a copied share link", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  const origin = baseURL;
  if (origin === undefined)
    throw new Error("The fixture requires a loopback base URL");
  const { requested, credentialed } = await mockPublicReplay(
    page,
    origin,
    "available",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText(text: string) {
          sessionStorage.setItem("fixture-copied-link", text);
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto(replayPath);
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Announcer preview/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Replay minimap" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  expect(requested).toEqual(
    expect.arrayContaining([
      contentPath,
      manifestPath,
      `${packageRoot}/${enginePath}`,
      resourcePath,
    ]),
  );
  expect(credentialed).toEqual([]);
  await play.click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Replay time" });
  await slider.press("End");
  await expect(slider).toHaveValue("60");
  await page.getByRole("combobox", { name: "Vision" }).selectOption("blue");
  await page.getByRole("combobox", { name: "Camera" }).selectOption("player:0");
  await expect(page.getByRole("combobox", { name: "Vision" })).toHaveValue(
    "blue",
  );
  await expect(page.getByRole("combobox", { name: "Camera" })).toHaveValue(
    "player:0",
  );
  await page.getByRole("button", { name: "Copy replay link" }).click();
  const copied = await page.evaluate(() =>
    globalThis.sessionStorage.getItem("fixture-copied-link"),
  );
  expect(copied).toBe(`${origin}${replayPath}?t=60&follow=0&perspective=blue`);
  if (copied === null)
    throw new Error("The fixture did not receive the copied link");
  const viewer = await browser.newContext({ serviceWorkers: "block" });
  try {
    const shared = await viewer.newPage();
    const restored = await mockPublicReplay(shared, origin, "available");
    await shared.goto(copied);
    await expect(
      shared.getByRole("slider", { name: "Replay time" }),
    ).toHaveValue("60");
    await expect(shared.getByRole("combobox", { name: "Vision" })).toHaveValue(
      "blue",
    );
    await expect(shared.getByRole("combobox", { name: "Camera" })).toHaveValue(
      "player:0",
    );
    expect(restored.credentialed).toEqual([]);
    await shared.getByRole("region", { name: "Replay player" }).screenshot({
      path: testInfo.outputPath("restored-share.png"),
    });
  } finally {
    await viewer.close();
  }
});

for (const [status, message] of [
  ["corrupt replay", "The replay download could not be verified."],
  [
    "corrupt worker",
    "Replay resource integrity check failed: fixture-worker.mjs",
  ],
] as const) {
  test(`signed-out playback rejects a ${status}`, async ({ baseURL, page }) => {
    const { requested } = await mockPublicReplay(page, baseURL, status);
    await page.goto(replayPath);
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toHaveCount(0);
    if (status === "corrupt replay")
      expect(requested).not.toContain(manifestPath);
    else expect(requested).toContain(resourcePath);
  });
}
