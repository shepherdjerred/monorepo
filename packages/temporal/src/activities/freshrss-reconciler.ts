import { parseExportedFeedFilters } from "./freshrss-exported-opml.ts";
import { assertNoSharedStaleSubscriptions } from "./freshrss-subscription-safety.ts";

export type FetchRequest = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DesiredFeed = {
  title: string;
  url: string;
  htmlUrl?: string;
  description?: string;
  filtersActionRead?: string;
};

export type DesiredManifest = {
  category: string;
  feeds: DesiredFeed[];
};

type SubscriptionCategory = {
  id: string;
  label: string;
};

type Subscription = {
  id: string;
  title: string;
  url: string;
  categories: SubscriptionCategory[];
};

export type ReconcileInput = {
  apiUrl: string;
  user: string;
  password: string;
  category: string;
  manifest: DesiredManifest;
  request?: FetchRequest;
  delay?: (milliseconds: number) => Promise<void>;
};

export type ReconcileResult = {
  desired: number;
  edited: number;
  pruned: number;
};

function requireRecord(value: unknown, context: string): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value;
}

function getField(record: object, key: string): unknown {
  const value: unknown = Reflect.get(record, key);
  return value;
}

function requireString(record: object, key: string, context: string): string {
  const value = getField(record, key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

export function parseDesiredManifest(value: unknown): DesiredManifest {
  const record = requireRecord(value, "desired manifest");
  const category = requireString(record, "category", "desired manifest");
  const rawFeeds = getField(record, "feeds");
  if (!Array.isArray(rawFeeds) || rawFeeds.length === 0) {
    throw new Error("desired manifest.feeds must be a non-empty array");
  }
  const feeds = rawFeeds.map((rawFeed, index) => {
    const feedRecord = requireRecord(
      rawFeed,
      `desired manifest.feeds[${String(index)}]`,
    );
    const title = requireString(
      feedRecord,
      "title",
      `desired manifest.feeds[${String(index)}]`,
    );
    const url = requireString(
      feedRecord,
      "url",
      `desired manifest.feeds[${String(index)}]`,
    );
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(
        `desired manifest.feeds[${String(index)}].url must use HTTP or HTTPS`,
      );
    }
    const htmlUrl = getField(feedRecord, "htmlUrl");
    const description = getField(feedRecord, "description");
    const filtersActionRead = getField(feedRecord, "filtersActionRead");
    if (htmlUrl !== undefined && typeof htmlUrl !== "string") {
      throw new Error(
        `desired manifest.feeds[${String(index)}].htmlUrl must be a string`,
      );
    }
    if (description !== undefined && typeof description !== "string") {
      throw new Error(
        `desired manifest.feeds[${String(index)}].description must be a string`,
      );
    }
    if (
      filtersActionRead !== undefined &&
      typeof filtersActionRead !== "string"
    ) {
      throw new Error(
        `desired manifest.feeds[${String(index)}].filtersActionRead must be a string`,
      );
    }
    return {
      title,
      url,
      ...(htmlUrl === undefined ? {} : { htmlUrl }),
      ...(description === undefined ? {} : { description }),
      ...(filtersActionRead === undefined ? {} : { filtersActionRead }),
    };
  });
  if (new Set(feeds.map((feed) => feed.url)).size !== feeds.length) {
    throw new Error("desired manifest feed URLs must be unique");
  }
  return { category, feeds };
}

function parseSubscriptions(value: unknown): Subscription[] {
  const record = requireRecord(value, "subscription list response");
  const rawSubscriptions = getField(record, "subscriptions");
  if (!Array.isArray(rawSubscriptions)) {
    throw new TypeError(
      "subscription list response must contain a subscriptions array",
    );
  }
  return rawSubscriptions.map((rawSubscription, index) => {
    const context = `subscriptions[${String(index)}]`;
    const subscriptionRecord = requireRecord(rawSubscription, context);
    const rawCategories = getField(subscriptionRecord, "categories");
    if (!Array.isArray(rawCategories)) {
      throw new TypeError(`${context}.categories must be an array`);
    }
    const categories = rawCategories.map((rawCategory, categoryIndex) => {
      const categoryContext = `${context}.categories[${String(categoryIndex)}]`;
      const categoryRecord = requireRecord(rawCategory, categoryContext);
      return {
        id: requireString(categoryRecord, "id", categoryContext),
        label: requireString(categoryRecord, "label", categoryContext),
      };
    });
    return {
      id: requireString(subscriptionRecord, "id", context),
      title: requireString(subscriptionRecord, "title", context),
      url: requireString(subscriptionRecord, "url", context),
      categories,
    };
  });
}

class FreshRssReaderClient {
  readonly #apiUrl: string;
  readonly #user: string;
  readonly #password: string;
  readonly #request: FetchRequest;
  #authorization: string | undefined;
  #token: string | undefined;

  constructor(
    apiUrl: string,
    user: string,
    password: string,
    request: FetchRequest,
  ) {
    this.#apiUrl = apiUrl.replace(/\/$/, "");
    this.#user = user;
    this.#password = password;
    this.#request = request;
  }

  async authenticate(): Promise<void> {
    const body = new URLSearchParams({
      Email: this.#user,
      Passwd: this.#password,
    });
    const response = await this.#request(
      `${this.#apiUrl}/accounts/ClientLogin`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `FreshRSS authentication failed: HTTP ${String(response.status)}`,
      );
    }
    const authLine = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("Auth="));
    if (authLine === undefined || authLine.slice(5) === "") {
      throw new Error("FreshRSS authentication response did not contain Auth");
    }
    this.#authorization = authLine.slice(5);
    const tokenResponse = await this.#authorizedRequest("/reader/api/0/token");
    const tokenText = await tokenResponse.text();
    const token = tokenText.trim();
    if (token === "") throw new Error("FreshRSS token response was empty");
    this.#token = token;
  }

  async exportOpml(): Promise<string> {
    const response = await this.#authorizedRequest(
      "/reader/api/0/subscription/export",
    );
    return response.text();
  }

  async listSubscriptions(): Promise<Subscription[]> {
    const response = await this.#authorizedRequest(
      "/reader/api/0/subscription/list?output=json",
    );
    const value: unknown = await response.json();
    return parseSubscriptions(value);
  }

  async editSubscription(
    id: string,
    title: string,
    category: string,
    previousCategories: SubscriptionCategory[],
  ): Promise<void> {
    const body = new URLSearchParams({
      s: id,
      ac: "edit",
      a: `user/-/label/${category}`,
      t: title,
      T: this.#requireToken(),
    });
    for (const previousCategory of previousCategories) {
      if (previousCategory.label !== category) {
        body.append("r", previousCategory.id);
      }
    }
    await this.#edit(body);
  }

  async subscribe(url: string, title: string, category: string): Promise<void> {
    await this.#edit(
      new URLSearchParams({
        s: `feed/${url}`,
        ac: "subscribe",
        a: `user/-/label/${category}`,
        t: title,
        T: this.#requireToken(),
      }),
    );
  }

  async unsubscribe(id: string): Promise<void> {
    await this.#edit(
      new URLSearchParams({
        s: id,
        ac: "unsubscribe",
        T: this.#requireToken(),
      }),
    );
  }

  async #edit(body: URLSearchParams): Promise<void> {
    const response = await this.#authorizedRequest(
      "/reader/api/0/subscription/edit",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    const responseText = await response.text();
    const text = responseText.trim();
    if (text !== "OK") {
      throw new Error(
        `FreshRSS subscription edit returned ${JSON.stringify(text)}`,
      );
    }
  }

  async #authorizedRequest(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    if (this.#authorization === undefined) {
      throw new Error("FreshRSS client is not authenticated");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `GoogleLogin auth=${this.#authorization}`);
    const response = await this.#request(`${this.#apiUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw new Error(
        `FreshRSS API ${path} failed: HTTP ${String(response.status)}`,
      );
    }
    return response;
  }

  #requireToken(): string {
    if (this.#token === undefined)
      throw new Error("FreshRSS edit token is unavailable");
    return this.#token;
  }
}

function isInCategory(subscription: Subscription, category: string): boolean {
  return subscription.categories.some(
    (candidate) => candidate.label === category,
  );
}

function unmanagedFingerprint(
  subscriptions: Subscription[],
  desiredUrls: Set<string>,
  category: string,
): string {
  return JSON.stringify(
    subscriptions
      .filter(
        (subscription) =>
          !desiredUrls.has(subscription.url) &&
          !isInCategory(subscription, category),
      )
      .map((subscription) => ({
        id: subscription.id,
        title: subscription.title,
        url: subscription.url,
        categories: subscription.categories
          .map((candidate) => ({ id: candidate.id, label: candidate.label }))
          .toSorted((left, right) => left.id.localeCompare(right.id)),
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  );
}

async function waitForExactFilters(
  client: FreshRssReaderClient,
  feeds: DesiredFeed[],
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const attempts = 12;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const filtersByUrl = parseExportedFeedFilters(await client.exportOpml());
    const mismatches = feeds.filter(
      (feed) =>
        !filtersByUrl.has(feed.url) ||
        filtersByUrl.get(feed.url) !== feed.filtersActionRead,
    );
    if (mismatches.length === 0) return;
    if (attempt < attempts) await delay(5000);
  }
  throw new Error(
    "FreshRSS managed feed filters did not converge to the desired OPML settings",
  );
}

export async function reconcileFreshRss(
  input: ReconcileInput,
): Promise<ReconcileResult> {
  if (input.category !== input.manifest.category) {
    throw new Error(
      "FRESHRSS_CATEGORY does not match the desired manifest category",
    );
  }
  const desired = parseDesiredManifest(input.manifest);
  const desiredByUrl = new Map(desired.feeds.map((feed) => [feed.url, feed]));
  const desiredUrls = new Set(desiredByUrl.keys());
  const client = new FreshRssReaderClient(
    input.apiUrl,
    input.user,
    input.password,
    input.request ?? fetch,
  );
  await client.authenticate();
  const before = await client.listSubscriptions();
  assertNoSharedStaleSubscriptions(before, desiredUrls, desired.category);
  const unmanagedBefore = unmanagedFingerprint(
    before,
    desiredUrls,
    desired.category,
  );

  const beforeByUrl = new Map(
    before.map((subscription) => [subscription.url, subscription]),
  );
  for (const feed of desired.feeds) {
    if (!beforeByUrl.has(feed.url)) {
      await client.subscribe(feed.url, feed.title, desired.category);
    }
  }
  const imported = await client.listSubscriptions();
  const importedByUrl = new Map(
    imported.map((subscription) => [subscription.url, subscription]),
  );
  for (const feed of desired.feeds) {
    const subscription = importedByUrl.get(feed.url);
    if (subscription === undefined) {
      throw new Error(
        `FreshRSS subscribe did not create subscription ${feed.url}`,
      );
    }
    await client.editSubscription(
      subscription.id,
      feed.title,
      desired.category,
      subscription.categories,
    );
  }

  const moved = await client.listSubscriptions();
  const stale = moved.filter(
    (subscription) =>
      isInCategory(subscription, desired.category) &&
      !desiredUrls.has(subscription.url),
  );
  assertNoSharedStaleSubscriptions(moved, desiredUrls, desired.category);
  for (const subscription of stale) await client.unsubscribe(subscription.id);

  const after = await client.listSubscriptions();
  const managed = after.filter((subscription) =>
    isInCategory(subscription, desired.category),
  );
  if (managed.length !== desired.feeds.length) {
    throw new Error(
      `FreshRSS category ${JSON.stringify(desired.category)} has ${String(managed.length)} feeds; expected ${String(desired.feeds.length)}`,
    );
  }
  for (const subscription of managed) {
    const expected = desiredByUrl.get(subscription.url);
    const hasExactCategory =
      subscription.categories.length === 1 &&
      subscription.categories[0]?.label === desired.category;
    if (!hasExactCategory || subscription.title !== expected?.title) {
      throw new Error(
        `FreshRSS managed subscription mismatch: ${JSON.stringify({ title: subscription.title, url: subscription.url })}`,
      );
    }
  }
  const unmanagedAfter = unmanagedFingerprint(
    after,
    desiredUrls,
    desired.category,
  );
  if (unmanagedAfter !== unmanagedBefore) {
    throw new Error(
      "FreshRSS reconciliation changed a subscription outside the managed category",
    );
  }
  await waitForExactFilters(client, desired.feeds, input.delay ?? Bun.sleep);

  return {
    desired: desired.feeds.length,
    edited: desired.feeds.length,
    pruned: stale.length,
  };
}
