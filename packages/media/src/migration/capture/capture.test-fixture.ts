import { expect } from "vitest";

/** Capture fixtures permit only the same GET-only transport as the real reader. */
export function captureGetFixture(reply: (url: URL) => unknown): typeof fetch {
  return Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      expect(init?.method).toBe("GET");
      return Promise.resolve(
        Response.json(
          reply(new URL(input instanceof Request ? input.url : input)),
        ),
      );
    },
    {
      preconnect() {
        /* No network in capture fixtures. */
      },
    },
  );
}
