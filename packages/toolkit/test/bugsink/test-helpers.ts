export type BugsinkTestEnvironment = {
  originalFetch: typeof fetch;
  originalUrl: string | undefined;
  originalToken: string | undefined;
  restore: () => void;
};

export function captureBugsinkEnvironment(): BugsinkTestEnvironment {
  const originalFetch = globalThis.fetch;
  const originalUrl = Bun.env["BUGSINK_URL"];
  const originalToken = Bun.env["BUGSINK_TOKEN"];

  return {
    originalFetch,
    originalUrl,
    originalToken,
    restore: () => {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) {
        Reflect.deleteProperty(Bun.env, "BUGSINK_URL");
      } else {
        Bun.env["BUGSINK_URL"] = originalUrl;
      }
      if (originalToken === undefined) {
        Reflect.deleteProperty(Bun.env, "BUGSINK_TOKEN");
      } else {
        Bun.env["BUGSINK_TOKEN"] = originalToken;
      }
    },
  };
}
