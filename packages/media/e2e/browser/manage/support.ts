import { expect, type Page, type Request, type Route } from "@playwright/test";
import { FIXTURE_CSRF_TOKEN } from "#testing/fixture-api/server.ts";
import { openSettled, violationDetails } from "#e2e/browser/support.ts";

/**
 * Opens one of the owner's Manage pages and waits for its sections (and the
 * fixture session's CSRF cookie) to settle before sending commands.
 */
export async function openManage(page: Page, path: string) {
  await openSettled(page, "owner", path);
}

/** Opens a row that is closed until asked for, such as a provider. */
export async function openRow(page: Page, name: string) {
  await page
    .locator("summary")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
}

export type Write = {
  method: string;
  path: string;
  body: unknown;
  /** The key that lets the server recognize a retry of the same command. */
  idempotencyKey: string | undefined;
};

/**
 * Answers writes to `path` in place of the fixture API, which is read-only
 * and returns 501 for them. Each write is recorded, with its headers
 * checked, so a test can assert exactly what the client would have sent.
 * Nothing is saved anywhere: these tests prove requests, not persistence.
 */
export async function answerWrites(
  page: Page,
  path: string,
  response?: { status?: number; json: unknown },
  /** The `/api/v<version>` the client writes this path under. */
  version = 1,
): Promise<Write[]> {
  return interceptWrites(page, path, version, (route) =>
    route.fulfill({
      status: response?.status ?? 200,
      json: response?.json ?? {},
    }),
  );
}

/**
 * Drops the connection of every write to `path`: the page gets no answer at
 * all, as when a response is lost after the server may have acted on it.
 * Returns what was sent, so a test can tell the request did go out.
 */
export async function dropWrites(
  page: Page,
  path: string,
  version = 1,
): Promise<Write[]> {
  return interceptWrites(page, path, version, (route) =>
    route.abort("connectionreset"),
  );
}

async function interceptWrites(
  page: Page,
  path: string,
  version: number,
  respond: (route: Route) => Promise<void>,
): Promise<Write[]> {
  const writes: Write[] = [];
  await page.route(`**/api/v${String(version)}${path}`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fallback();
      return;
    }
    writes.push(recorded(request));
    await respond(route);
  });
  return writes;
}

function recorded(request: Request): Write {
  const headers = request.headers();
  expect([FIXTURE_CSRF_TOKEN, "browser-test"]).toContain(
    headers["x-csrf-token"],
  );
  expect(headers["idempotency-key"]).toMatch(/^[\da-f-]{36}$/u);
  return {
    method: request.method(),
    path: new URL(request.url()).pathname,
    body: request.postDataJSON(),
    idempotencyKey: headers["idempotency-key"],
  };
}

/** WCAG 2.2 AA violations on the page as it stands, as `rule: selectors`. */
export async function violations(page: Page): Promise<string[]> {
  // A dialog fades in; measured part-way through, its text is fainter than
  // it will be. Wait for everything that ends. A skeleton's pulse never does.
  await page.evaluate(async () => {
    const ending = globalThis.document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().endTime !== Infinity,
      );
    await Promise.allSettled(ending.map((animation) => animation.finished));
  });
  return violationDetails(page);
}

/** The keys the client has put in session storage to retry a command. */
export async function storedCommandKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(globalThis.sessionStorage).filter((key) =>
      key.startsWith("media.command."),
    ),
  );
}

/** Everything the page has put in the browser's storage, as one string. */
export async function storageContents(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify([
      Object.entries(globalThis.sessionStorage),
      Object.entries(globalThis.localStorage),
    ]),
  );
}
