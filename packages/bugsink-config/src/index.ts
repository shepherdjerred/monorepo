import type { DataCollection } from "@sentry/core";

/** Combine application identity with the shared browser privacy policy. */
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
  dataCollection: DataCollection;
} {
  return {
    dsn,
    environment,
    release: typeof release === "string" ? release : undefined,
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
