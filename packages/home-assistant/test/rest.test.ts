import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import {
  HaApiError,
  HaAuthError,
  HaNotFoundError,
  HomeAssistantRestClient,
} from "#lib";

type FetchArgs = {
  url: string;
  init: RequestInit | undefined;
};

type FetchCall = {
  args: FetchArgs;
  response: Response;
};

function inputToString(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

const noopPreconnect = (): void => {
  // no-op for tests
};

function makeFetch(
  responder: (args: FetchArgs) => Response | Promise<Response>,
): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const args: FetchArgs = { url: inputToString(input), init };
    const response = await responder(args);
    calls.push({ args, response: response.clone() });
    return response;
  };
  const fn = Object.assign(impl, {
    preconnect: noopPreconnect,
  }) satisfies typeof fetch;
  return { fn, calls };
}

const HeadersRecord = z.record(z.string(), z.string());

function getHeaders(init: RequestInit | undefined): Record<string, string> {
  const parsed = HeadersRecord.safeParse(init?.headers);
  return parsed.success ? parsed.data : {};
}

const RequestBody = z.string();

function getBody(init: RequestInit | undefined): string {
  const parsed = RequestBody.safeParse(init?.body);
  return parsed.success ? parsed.data : "";
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HomeAssistantRestClient", () => {
  it("sends GET /api/states/:id with bearer auth and parses state", async () => {
    const { fn, calls } = makeFetch(() =>
      Response.json({
        entity_id: "light.kitchen",
        state: "on",
        attributes: { brightness: 200 },
        last_changed: "2024-01-01T00:00:00+00:00",
        last_updated: "2024-01-01T00:00:00+00:00",
      }),
    );
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123/",
      token: "secret",
    });

    const state = await client.getState("light.kitchen");

    expect(state.entity_id).toBe("light.kitchen");
    expect(state.state).toBe("on");
    expect(state.attributes["brightness"]).toBe(200);
    expect(calls[0]?.args.url).toBe(
      "http://ha.local:8123/api/states/light.kitchen",
    );
    expect(calls[0]?.args.init?.method).toBe("GET");
    expect(getHeaders(calls[0]?.args.init)["Authorization"]).toBe(
      "Bearer secret",
    );
  });

  it("POSTs to /api/services/:domain/:service with JSON body", async () => {
    const { fn, calls } = makeFetch(() => Response.json([]));
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    await client.callService("light", "turn_on", {
      entity_id: "light.kitchen",
      brightness: 150,
    });

    expect(calls[0]?.args.url).toBe(
      "http://ha.local:8123/api/services/light/turn_on",
    );
    expect(calls[0]?.args.init?.method).toBe("POST");
    const body: unknown = JSON.parse(getBody(calls[0]?.args.init));
    expect(body).toEqual({ entity_id: "light.kitchen", brightness: 150 });
  });

  it("appends ?return_response when requested", async () => {
    const { fn, calls } = makeFetch(() => Response.json([]));
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    await client.callService(
      "weather",
      "get_forecast",
      { entity_id: "weather.home" },
      { returnResponse: true },
    );

    expect(calls[0]?.args.url).toBe(
      "http://ha.local:8123/api/services/weather/get_forecast?return_response",
    );
  });
});

describe("HomeAssistantRestClient service-response mode", () => {
  it("parses the object payload returned when returnResponse is true", async () => {
    const { fn } = makeFetch(() =>
      Response.json({
        changed_states: [],
        service_response: {
          "weather.home": {
            forecast: [{ datetime: "2024-01-01T00:00:00Z", temperature: 20 }],
          },
        },
      }),
    );
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    const result = await client.callService(
      "weather",
      "get_forecast",
      { entity_id: "weather.home" },
      { returnResponse: true },
    );

    expect(Array.isArray(result)).toBe(false);
    if (!Array.isArray(result)) {
      expect(result.service_response).toBeDefined();
    }
  });

  it("throws HaAuthError on 401", async () => {
    const { fn } = makeFetch(
      () => new Response("Unauthorized", { status: 401 }),
    );
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "bad",
    });

    await expect(client.getState("light.kitchen")).rejects.toBeInstanceOf(
      HaAuthError,
    );
  });

  it("throws HaNotFoundError on 404", async () => {
    const { fn } = makeFetch(() => new Response("Not found", { status: 404 }));
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    let caught: unknown;
    try {
      await client.getState("light.missing");
    } catch (error_: unknown) {
      caught = error_;
    }
    expect(caught).toBeInstanceOf(HaNotFoundError);
    if (caught instanceof HaNotFoundError) {
      expect(caught.status).toBe(404);
    }
  });

  it("throws HaApiError on other non-2xx", async () => {
    const { fn } = makeFetch(() => new Response("server err", { status: 500 }));
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    let caught: unknown;
    try {
      await client.getStates();
    } catch (error_: unknown) {
      caught = error_;
    }
    expect(caught).toBeInstanceOf(HaApiError);
    if (caught instanceof HaApiError) {
      expect(caught.status).toBe(500);
    }
  });

  it("fires events", async () => {
    const { fn, calls } = makeFetch(() =>
      Response.json({ message: "Event fired" }),
    );
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    const result = await client.fireEvent("my_event", { foo: "bar" });
    expect(result.message).toBe("Event fired");
    expect(calls[0]?.args.url).toBe("http://ha.local:8123/api/events/my_event");
  });

  it("renderTemplate throws HaApiError on non-2xx instead of returning the body", async () => {
    const { fn } = makeFetch(
      () => new Response("bad template", { status: 400 }),
    );
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    let caught: unknown;
    try {
      await client.renderTemplate("{{ invalid }}");
    } catch (error_: unknown) {
      caught = error_;
    }
    expect(caught).toBeInstanceOf(HaApiError);
    if (caught instanceof HaApiError) {
      expect(caught.status).toBe(400);
    }
  });

  it("renderTemplate throws HaAuthError on 401", async () => {
    const { fn } = makeFetch(
      () => new Response("unauthorized", { status: 401 }),
    );
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    let caught: unknown;
    try {
      await client.renderTemplate("{{ states('light.kitchen') }}");
    } catch (error_: unknown) {
      caught = error_;
    }
    expect(caught).toBeInstanceOf(HaAuthError);
  });

  it("notifies handler registered with mock", async () => {
    const handler = mock(() => Response.json([]));
    const { fn, calls } = makeFetch(() => handler());
    globalThis.fetch = fn;

    const client = new HomeAssistantRestClient({
      baseUrl: "http://ha.local:8123",
      token: "t",
    });

    await client.callService("notify", "notify", {
      title: "Hi",
      message: "Hello",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls[0]?.args.url).toContain("/api/services/notify/notify");
  });
});
