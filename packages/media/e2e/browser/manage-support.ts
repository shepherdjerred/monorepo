import { expect, type Page, type Request } from "@playwright/test";
import { allowWrites, openSettled, violationDetails } from "./support.ts";

/**
 * Opens one of the owner's Manage pages, waits for its sections to load, and
 * lets it send the commands a test then answers with `answerWrites`.
 */
export async function openManage(page: Page, path: string) {
  await openSettled(page, "owner", path);
  await allowWrites(page);
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
): Promise<Write[]> {
  const writes: Write[] = [];
  await page.route(`**/api/v1${path}`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fallback();
      return;
    }
    writes.push(recorded(request));
    await route.fulfill({
      status: response?.status ?? 200,
      json: response?.json ?? {},
    });
  });
  return writes;
}

function recorded(request: Request): Write {
  const headers = request.headers();
  expect(headers["x-csrf-token"]).toBe("browser-test");
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
