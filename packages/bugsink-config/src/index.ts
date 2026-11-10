import type { DataCollection } from "@sentry/core";

/**
 * Combine application identity with the shared browser privacy policy.
 * `attachStacktrace` is false, the SDK v10 default, so `captureMessage`
 * reports a plain message rather than a synthetic exception.
 */
export function bugsinkBrowserOptions({
  dsn,
  environment,
  release,
}: {
  dsn: string;
  environment: string;
  release: unknown;
}): {
  dsn: string;
  environment: string;
  release: string | undefined;
  attachStacktrace: false;
  dataCollection: DataCollection;
} {
  return {
    dsn,
    environment,
    release: typeof release === "string" ? release : undefined,
    attachStacktrace: false,
    dataCollection: bugsinkDataCollection(),
  };
}

/** Preserve the SDK v10 privacy baseline when initializing a Sentry SDK v11 client. */
export function bugsinkDataCollection(): DataCollection {
  const deniedFields = ["forwarded", "-ip", "remote-", "via", "-user"];
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { deny: [...deniedFields] },
      response: { deny: [...deniedFields] },
    },
    httpBodies: [],
    urlQueryParams: { deny: [...deniedFields] },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
  };
}
