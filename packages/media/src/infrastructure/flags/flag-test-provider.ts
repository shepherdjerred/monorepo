import { FlagsProvider } from "@shepherdjerred/feature-flags/providers/flags.ts";

export function createToggleableFlagProvider(key: string): {
  readonly provider: FlagsProvider;
  disconnect: () => void;
} {
  let online = true;
  return {
    provider: new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "streambot/prod",
      pollIntervalSeconds: 300,
      fetcher: () => {
        if (!online) return Promise.reject(new Error("offline"));
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              deployment: "streambot/prod",
              revision: 1,
              flags: [{ type: "boolean", key, default: true, rollouts: [] }],
            }),
        });
      },
    }),
    disconnect: () => {
      online = false;
    },
  };
}
