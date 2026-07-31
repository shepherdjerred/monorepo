import { describe, expect, it } from "bun:test";
import {
  fetchGithubTagArchive,
  githubTagArchiveUrl,
  isRetryableGithubArchiveError,
  type GithubTagArchiveFetchOptions,
} from "./github-tag-archive.ts";

function errorWithCode(code: string): Error {
  const error = new Error("network request failed");
  Object.defineProperty(error, "code", { value: code });
  return error;
}

function optionsFor(
  responses: (Response | Error)[],
  delays: number[],
): GithubTagArchiveFetchOptions {
  return {
    fetchFn: () => {
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Test exhausted its configured responses");
      }
      return response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response);
    },
    sleepFn: (milliseconds) => {
      delays.push(milliseconds);
      return Promise.resolve();
    },
    warnFn: (message) => {
      if (!message.includes("Transient archive fetch failure")) {
        throw new Error(`Unexpected retry warning: ${message}`);
      }
    },
  };
}

describe("githubTagArchiveUrl", () => {
  it("uses GitHub's direct codeload tag endpoint", () => {
    expect(githubTagArchiveUrl("owner/repo", "v1.2.3")).toBe(
      "https://codeload.github.com/owner/repo/tar.gz/refs/tags/v1.2.3",
    );
  });
});

describe("isRetryableGithubArchiveError", () => {
  it.each([
    "ConnectionClosed",
    "ConnectionRefused",
    "ConnectionResetByPeer",
    "FailedToOpenSocket",
    "ECONNREFUSED",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
  ])("recognizes retryable transport code %s", (code) => {
    expect(isRetryableGithubArchiveError(errorWithCode(code))).toBe(true);
  });

  it("recognizes retryable nested causes", () => {
    expect(
      isRetryableGithubArchiveError(
        new Error("fetch failed", { cause: errorWithCode("ECONNREFUSED") }),
      ),
    ).toBe(true);
  });

  it("does not retry unrelated programming errors", () => {
    expect(
      isRetryableGithubArchiveError(new TypeError("invalid argument")),
    ).toBe(false);
  });
});

describe("fetchGithubTagArchive", () => {
  it.each([408, 429, 500, 502, 503, 504])(
    "retries transient HTTP status %i",
    async (status) => {
      const delays: number[] = [];
      const bytes = await fetchGithubTagArchive(
        "owner/repo",
        "v1",
        optionsFor(
          [new Response(null, { status }), new Response("archive")],
          delays,
        ),
      );

      expect(new TextDecoder().decode(bytes)).toBe("archive");
      expect(delays).toEqual([1000]);
    },
  );

  it("retries transient HTTP responses with bounded backoff", async () => {
    const delays: number[] = [];
    const bytes = await fetchGithubTagArchive(
      "owner/repo",
      "v1",
      optionsFor(
        [
          new Response(null, { status: 503 }),
          new Response(null, { status: 429 }),
          new Response("archive"),
        ],
        delays,
      ),
    );

    expect(new TextDecoder().decode(bytes)).toBe("archive");
    expect(delays).toEqual([1000, 2000]);
  });

  it("retries recognized transport failures", async () => {
    const delays: number[] = [];
    const bytes = await fetchGithubTagArchive(
      "owner/repo",
      "v1",
      optionsFor(
        [errorWithCode("ConnectionRefused"), new Response("archive")],
        delays,
      ),
    );

    expect(new TextDecoder().decode(bytes)).toBe("archive");
    expect(delays).toEqual([1000]);
  });

  it.each(["ConnectionClosed", "FailedToOpenSocket"])(
    "retries Bun's native closed-socket failure %s",
    async (code) => {
      const delays: number[] = [];
      const bytes = await fetchGithubTagArchive(
        "owner/repo",
        "v1",
        optionsFor([errorWithCode(code), new Response("archive")], delays),
      );

      expect(new TextDecoder().decode(bytes)).toBe("archive");
      expect(delays).toEqual([1000]);
    },
  );

  it("fails permanent HTTP responses immediately", async () => {
    const delays: number[] = [];
    const operation = fetchGithubTagArchive(
      "owner/repo",
      "v1",
      optionsFor([new Response(null, { status: 404 })], delays),
    );

    await expect(operation).rejects.toThrow("HTTP 404");
    expect(delays).toEqual([]);
  });

  it("fails after four transient attempts", async () => {
    const delays: number[] = [];
    const operation = fetchGithubTagArchive(
      "owner/repo",
      "v1",
      optionsFor(
        [
          new Response(null, { status: 503 }),
          new Response(null, { status: 503 }),
          new Response(null, { status: 503 }),
          new Response(null, { status: 503 }),
        ],
        delays,
      ),
    );

    await expect(operation).rejects.toThrow("after 4 attempts");
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("sets a timeout signal on every request", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    await fetchGithubTagArchive("owner/repo", "v1", {
      fetchFn: (_url, init) => {
        signals.push(init.signal);
        return Promise.resolve(new Response("archive"));
      },
      requestTimeoutMs: 123,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});
