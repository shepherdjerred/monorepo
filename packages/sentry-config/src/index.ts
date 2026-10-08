import type { DataCollection } from "@sentry/core";

/** Preserve the SDK v10 privacy baseline when initializing a Sentry v11 client. */
export function sentryDataCollection(): DataCollection {
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
