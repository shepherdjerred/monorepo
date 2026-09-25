import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAlertmanagerPoster,
  type AlertmanagerAlert,
} from "./alertmanager.ts";

const ALERT: AlertmanagerAlert = {
  labels: { alertname: "TestAlert" },
  annotations: {},
  startsAt: "2026-07-30T18:00:00.000Z",
  endsAt: "2026-07-31T18:00:00.000Z",
};

/**
 * Never settles on its own; rejects once `signal` aborts, carrying the abort
 * reason as the cause like a real fetch rejection does.
 */
function hungUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new Error("fetch aborted", { cause: signal.reason })),
      { once: true },
    );
  });
}

function abortSignalFromInit(init: RequestInit | undefined): AbortSignal {
  const signal = init?.signal;
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError("expected the poster to pass an abort signal");
  }
  return signal;
}

async function rejectionReason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

function expectTimeoutAbort(error: unknown): void {
  if (!(error instanceof Error)) {
    throw new TypeError("expected the POST to reject with an error");
  }
  expect(error.message).toBe("fetch aborted");
  const cause = error.cause;
  if (!(cause instanceof DOMException)) {
    throw new TypeError("expected a DOMException abort reason");
  }
  expect(cause.name).toBe("TimeoutError");
}

describe("createAlertmanagerPoster", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts alerts with an abort signal", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        seen.push({ url: String(url), init });
        return new Response("{}", { status: 200 });
      }),
    );

    await createAlertmanagerPoster("http://alertmanager:9093")([ALERT]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://alertmanager:9093/api/v2/alerts");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a hung POST", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) =>
        hungUntilAbort(abortSignalFromInit(init)),
      ),
    );

    expectTimeoutAbort(
      await rejectionReason(
        createAlertmanagerPoster("http://alertmanager:9093", 10)([ALERT]),
      ),
    );
  });

  it("aborts a stalled error-response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const response = new Response("", { status: 500 });
        Object.defineProperty(response, "text", {
          value: () => hungUntilAbort(abortSignalFromInit(init)),
        });
        return response;
      }),
    );

    expectTimeoutAbort(
      await rejectionReason(
        createAlertmanagerPoster("http://alertmanager:9093", 10)([ALERT]),
      ),
    );
  });
});
