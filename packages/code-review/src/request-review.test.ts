import { afterEach, describe, expect, test } from "vitest";
import { codexProvider } from "./providers/codex.ts";
import { greptileProvider } from "./providers/greptile.ts";
import { qodoProvider } from "./providers/qodo.ts";
import {
  buildReviewRequestMarker,
  requestReviewAtHead,
} from "./request-review.ts";

const HEAD = "ddca47f32df5f95b0fa79b96171aed94a1ce9536";
const originalFetch = globalThis.fetch;

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

/**
 * A stand-in for global `fetch`. Bun's `fetch` carries a `preconnect` method
 * alongside the call signature, so a bare function does not satisfy the type;
 * the real one is carried over rather than asserted away.
 */
function fakeFetch(
  handler: (input: FetchInput, init: FetchInit) => Promise<Response>,
): typeof globalThis.fetch {
  return Object.assign(handler, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Record every request, answering comment reads with `comments`. */
function stubGitHub(comments: readonly { body: string }[]) {
  const posted: { url: string; body: unknown }[] = [];
  globalThis.fetch = fakeFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (init?.method === "POST") {
      const raw = typeof init.body === "string" ? init.body : "";
      posted.push({ url, body: JSON.parse(raw) });
      return Response.json({ id: 1 });
    }
    return Response.json(comments);
  });
  return posted;
}

describe("buildReviewRequestMarker", () => {
  test("names the provider and the exact head", () => {
    expect(buildReviewRequestMarker("qodo", HEAD)).toBe(
      `<!-- review-request:qodo:${HEAD} -->`,
    );
  });

  test("gives different heads different markers", () => {
    expect(buildReviewRequestMarker("qodo", HEAD)).not.toBe(
      buildReviewRequestMarker("qodo", "a".repeat(40)),
    );
  });
});

describe("requestReviewAtHead", () => {
  const request = { repo: "o/r", number: 2095, head: HEAD, token: "t" };

  test("asks a provider that reviews only when asked", async () => {
    const posted = stubGitHub([]);
    expect(
      await requestReviewAtHead({ ...request, provider: qodoProvider }),
    ).toBe("requested");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe(
      "https://api.github.com/repos/o/r/issues/2095/comments",
    );
    expect(posted[0]?.body).toEqual({
      body:
        `/agentic_review\n\n<sub>Automated re-review request for ` +
        `\`${HEAD.slice(0, 7)}\` from the CI review gate.</sub>\n` +
        `<!-- review-request:qodo:${HEAD} -->`,
    });
  });

  test("says a request is automated so a reader knows it is not a person", async () => {
    const posted = stubGitHub([]);
    await requestReviewAtHead({ ...request, provider: codexProvider });
    expect(JSON.stringify(posted[0]?.body)).toContain(
      "Automated re-review request",
    );
  });

  test("marks a retry as such and keeps it separately idempotent", async () => {
    // The first attempt's marker must not suppress the second, or the retry
    // this exists to add would never be posted.
    const posted = stubGitHub([
      { body: `/agentic_review\n\n${buildReviewRequestMarker("qodo", HEAD)}` },
    ]);
    expect(
      await requestReviewAtHead({
        ...request,
        provider: qodoProvider,
        attempt: 2,
      }),
    ).toBe("requested");
    expect(JSON.stringify(posted[0]?.body)).toContain("attempt 2 of 2");
    expect(JSON.stringify(posted[0]?.body)).toContain(
      `<!-- review-request:qodo:${HEAD}:2 -->`,
    );
  });

  test("does not repeat the same retry attempt", async () => {
    const posted = stubGitHub([
      {
        body: `/agentic_review\n\n${buildReviewRequestMarker("qodo", HEAD, 2)}`,
      },
    ]);
    expect(
      await requestReviewAtHead({
        ...request,
        provider: qodoProvider,
        attempt: 2,
      }),
    ).toBe("already-requested");
    expect(posted).toHaveLength(0);
  });

  test("does not ask twice for the same head", async () => {
    const posted = stubGitHub([
      { body: `/agentic_review\n\n${buildReviewRequestMarker("qodo", HEAD)}` },
    ]);
    expect(
      await requestReviewAtHead({ ...request, provider: qodoProvider }),
    ).toBe("already-requested");
    expect(posted).toHaveLength(0);
  });

  test("recognises a request another consumer already posted", async () => {
    // The PR-fleet controller builds its marker with the same helper, so a
    // request it posted for this head must suppress the gate's.
    const posted = stubGitHub([
      { body: `something else` },
      {
        body: `/agentic_review\n\n${buildReviewRequestMarker("qodo", HEAD)}\n`,
      },
    ]);
    expect(
      await requestReviewAtHead({ ...request, provider: qodoProvider }),
    ).toBe("already-requested");
    expect(posted).toHaveLength(0);
  });

  test("still asks when only an older head was requested", async () => {
    const posted = stubGitHub([
      { body: buildReviewRequestMarker("qodo", "b".repeat(40)) },
    ]);
    expect(
      await requestReviewAtHead({ ...request, provider: qodoProvider }),
    ).toBe("requested");
    expect(posted).toHaveLength(1);
  });

  test("never asks a provider that reviews automatically", async () => {
    const posted = stubGitHub([]);
    expect(
      await requestReviewAtHead({ ...request, provider: greptileProvider }),
    ).toBe("unsupported");
    expect(posted).toHaveLength(0);
  });

  test("uses the configured provider's own trigger, never another's", async () => {
    const posted = stubGitHub([]);
    await requestReviewAtHead({ ...request, provider: codexProvider });
    const body = posted[0]?.body;
    expect(JSON.stringify(body)).toContain("codex");
    expect(JSON.stringify(body)).not.toContain("qodo");
  });

  test("fails loudly when the request cannot be posted", async () => {
    // Swallowing this would restore the behaviour this exists to remove:
    // waiting out the whole budget for a review nobody asked for.
    globalThis.fetch = fakeFetch(async (_input, init) =>
      init?.method === "POST"
        ? new Response("no", { status: 403, statusText: "Forbidden" })
        : Response.json([]),
    );
    await expect(
      requestReviewAtHead({ ...request, provider: qodoProvider }),
    ).rejects.toThrow(/403/u);
  });

  test("fails loudly when the comment listing is not an array", async () => {
    globalThis.fetch = fakeFetch(async () =>
      Response.json({ message: "Not Found" }),
    );
    await expect(
      requestReviewAtHead({ ...request, provider: qodoProvider }),
    ).rejects.toThrow(/was not an array/u);
  });
});
