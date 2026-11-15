import { describe, expect, test } from "vitest";
import type { z } from "zod";
import rawContract from "./desktop-api.contract.json" with { type: "json" };
import errorFixtures from "./desktop-fixtures/errors.json" with { type: "json" };
import statusFixture from "./desktop-fixtures/explore-status.json" with { type: "json" };
import listFixture from "./desktop-fixtures/explore-conversations-list.json" with { type: "json" };
import getFixture from "./desktop-fixtures/explore-conversations-get.json" with { type: "json" };
import pairingFixture from "./desktop-fixtures/pairings-v2.json" with { type: "json" };
import scopeRequestFixture from "./desktop-fixtures/device-scope-requests.json" with { type: "json" };
import startFixture from "./desktop-fixtures/explore-runs-start.json" with { type: "json" };
import stopFixture from "./desktop-fixtures/explore-runs-stop.json" with { type: "json" };
import activeFixture from "./desktop-fixtures/explore-runs-active.json" with { type: "json" };
import outcomeFixture from "./desktop-fixtures/explore-runs-outcome.json" with { type: "json" };
import streamFixture from "./desktop-fixtures/explore-runs-stream.json" with { type: "json" };
import assetsFixture from "./desktop-fixtures/explore-assets.json" with { type: "json" };
import visualizationFixture from "./desktop-fixtures/explore-visualization.json" with { type: "json" };
import visualsFixture from "./desktop-fixtures/explore-conversations-get-visuals.json" with { type: "json" };
import { ScoutClientCreatePairingSchema } from "./protocol.schema.ts";
import {
  ExploreActiveRunSchema,
  ExploreRunObserveRequestSchema,
  ExploreRunOutcomeResultSchema,
  ExploreTurnRequestSchema,
} from "#src/model/reports/explore.ts";
import {
  SCOUT_DESKTOP_API_ERRORS,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION,
  SCOUT_DESKTOP_ORIGIN_CONTRACT_VERSION,
  SCOUT_DESKTOP_PAIRING_V2_SCOPES,
  SCOUT_DESKTOP_STREAM_EVENT_TYPES,
  SCOUT_NATIVE_VISUALIZATION_KINDS,
  ScoutDesktopAssetsResponseSchema,
  ScoutDesktopPngResponseSchema,
  ScoutDesktopVisualizationRequestSchema,
  ScoutDesktopApiErrorCodeSchema,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopApiRouteSchema,
  ScoutDesktopConversationGetRequestSchema,
  ScoutDesktopConversationGetResponseSchema,
  ScoutDesktopConversationListRequestSchema,
  ScoutDesktopConversationListResponseSchema,
  ScoutDesktopExploreStatusRequestSchema,
  ScoutDesktopExploreStatusResponseSchema,
  ScoutDesktopEmptyRequestSchema,
  ScoutDesktopPairingV2ResponseSchema,
  ScoutDesktopScopeRequestResponseSchema,
  ScoutDesktopScopeRequestSchema,
  ScoutDesktopRunActiveResponseSchema,
  ScoutDesktopRunStopResponseSchema,
  ScoutDesktopRunStreamResponseSchema,
  ScoutDesktopScopeSchema,
  type ScoutDesktopApiRoute,
} from "./desktop-api.schema.ts";

type RouteFixture = {
  readonly route: string;
  readonly request: unknown;
  readonly response: unknown;
  readonly invalidRequests: readonly { reason: string; body: unknown }[];
};

/** The schemas each route's golden bodies are held to. */
const ROUTE_SCHEMAS: Record<
  ScoutDesktopApiRoute,
  { request: z.ZodType; response: z.ZodType; fixture: RouteFixture }
> = {
  pairings_v2: {
    request: ScoutClientCreatePairingSchema,
    response: ScoutDesktopPairingV2ResponseSchema,
    fixture: pairingFixture,
  },
  device_scope_requests: {
    request: ScoutDesktopScopeRequestSchema,
    response: ScoutDesktopScopeRequestResponseSchema,
    fixture: scopeRequestFixture,
  },
  explore_status: {
    request: ScoutDesktopExploreStatusRequestSchema,
    response: ScoutDesktopExploreStatusResponseSchema,
    fixture: statusFixture,
  },
  explore_conversations_list: {
    request: ScoutDesktopConversationListRequestSchema,
    response: ScoutDesktopConversationListResponseSchema,
    fixture: listFixture,
  },
  explore_conversations_get: {
    request: ScoutDesktopConversationGetRequestSchema,
    response: ScoutDesktopConversationGetResponseSchema,
    fixture: getFixture,
  },
  explore_runs_start: {
    request: ExploreTurnRequestSchema,
    response: ExploreActiveRunSchema,
    fixture: startFixture,
  },
  explore_runs_stop: {
    request: ExploreRunObserveRequestSchema,
    response: ScoutDesktopRunStopResponseSchema,
    fixture: stopFixture,
  },
  explore_runs_active: {
    request: ScoutDesktopEmptyRequestSchema,
    response: ScoutDesktopRunActiveResponseSchema,
    fixture: activeFixture,
  },
  explore_runs_outcome: {
    request: ExploreRunObserveRequestSchema,
    response: ExploreRunOutcomeResultSchema,
    fixture: outcomeFixture,
  },
  explore_runs_stream: {
    request: ExploreRunObserveRequestSchema,
    response: ScoutDesktopRunStreamResponseSchema,
    fixture: streamFixture,
  },
  explore_assets: {
    request: ScoutDesktopEmptyRequestSchema,
    response: ScoutDesktopAssetsResponseSchema,
    fixture: assetsFixture,
  },
  explore_visualization: {
    request: ScoutDesktopVisualizationRequestSchema,
    response: ScoutDesktopPngResponseSchema,
    fixture: visualizationFixture,
  },
};

const routeNames = ScoutDesktopApiRouteSchema.options;

describe("Scout desktop API contract", () => {
  test("keeps the TypeScript constants aligned with the shared contract", () => {
    expect(SCOUT_DESKTOP_CONTRACT_VERSION).toBe(rawContract.contractVersion);
    expect(SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION).toBe(
      rawContract.minimumContractVersion,
    );
    expect(SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION).toBeLessThanOrEqual(
      SCOUT_DESKTOP_CONTRACT_VERSION,
    );
    expect(SCOUT_DESKTOP_ORIGIN_CONTRACT_VERSION).toBeLessThanOrEqual(
      SCOUT_DESKTOP_CONTRACT_VERSION,
    );
    expect(SCOUT_DESKTOP_CONTRACT_HEADER).toBe(rawContract.header);
    expect(ScoutDesktopScopeSchema.options).toEqual(rawContract.scopes);
    expect([...SCOUT_DESKTOP_PAIRING_V2_SCOPES]).toEqual(
      rawContract.pairingScopes,
    );
    expect(SCOUT_DESKTOP_API_ROUTES).toEqual(rawContract.routes);
    expect(SCOUT_DESKTOP_API_ERRORS).toEqual(rawContract.errors);
    expect(ScoutDesktopApiErrorCodeSchema.options).toEqual(
      Object.keys(rawContract.errors),
    );
    expect(SCOUT_NATIVE_VISUALIZATION_KINDS).toEqual(
      rawContract.nativeVisualizationKinds,
    );
  });

  test("every route has a golden fixture and every fixture names a route", () => {
    expect(routeNames).toEqual(Object.keys(rawContract.routes));
    expect(routeNames).toEqual(Object.keys(SCOUT_DESKTOP_API_ROUTES));
    for (const name of routeNames) {
      expect(ROUTE_SCHEMAS[name].fixture.route).toBe(name);
    }
  });

  test("every error code has exactly one fixture with its status", () => {
    const codes = errorFixtures.errors.map((fixture) => fixture.body.error);
    expect(codes).toEqual(Object.keys(rawContract.errors));
    for (const fixture of errorFixtures.errors) {
      const code = ScoutDesktopApiErrorCodeSchema.parse(fixture.body.error);
      expect(fixture.status).toBe(SCOUT_DESKTOP_API_ERRORS[code]);
      expect(ScoutDesktopApiErrorSchema.parse(fixture.body)).toEqual(
        fixture.body,
      );
    }
  });

  test("the contract lists every stream event, and the golden stream has one of each", () => {
    expect(rawContract.streamEvents).toEqual(SCOUT_DESKTOP_STREAM_EVENT_TYPES);
    const types = ScoutDesktopRunStreamResponseSchema.parse(
      streamFixture.response,
    ).events.map((event) => event.type);
    expect(types).toEqual(rawContract.streamEvents);
  });

  test("only the stream route answers with an event stream", () => {
    const streaming = routeNames.filter(
      (name) => SCOUT_DESKTOP_API_ROUTES[name].response === "event-stream",
    );
    expect(streaming).toEqual(["explore_runs_stream"]);
  });

  test("only the chart route answers with a PNG", () => {
    const images = routeNames.filter(
      (name) => SCOUT_DESKTOP_API_ROUTES[name].response === "png",
    );
    expect(images).toEqual(["explore_visualization"]);
  });

  test("the visuals transcript holds a chart, a native table and both cards", () => {
    const { messages } = ScoutDesktopConversationGetResponseSchema.parse(
      visualsFixture.response,
    );
    const kinds = messages.flatMap((message) =>
      message.visualization === null ? [] : [message.visualization.kind],
    );
    expect(kinds).toEqual(["BAR_CHART", "TABLE"]);
    expect(
      kinds.map((kind) => SCOUT_NATIVE_VISUALIZATION_KINDS.includes(kind)),
    ).toEqual([false, true]);
    expect(messages.flatMap((message) => message.matchCards)).toHaveLength(1);
    expect(messages.flatMap((message) => message.loadoutCards)).toHaveLength(1);
    expect(visualizationFixture.request.messageId).toBe(messages[1]?.id);
  });

  test.each(routeNames)("%s golden bodies round-trip", (name) => {
    const { request, response, fixture } = ROUTE_SCHEMAS[name];
    expect(request.parse(fixture.request)).toEqual(fixture.request);
    expect(response.parse(fixture.response)).toEqual(fixture.response);
  });

  test.each(
    routeNames.flatMap((name) =>
      ROUTE_SCHEMAS[name].fixture.invalidRequests.map((invalid) => ({
        name,
        ...invalid,
      })),
    ),
  )("$name refuses $reason", ({ name, body }) => {
    expect(ROUTE_SCHEMAS[name].request.safeParse(body).success).toBe(false);
  });

  test("a scope request must name at least one scope", () => {
    expect(
      ScoutDesktopScopeRequestSchema.safeParse({ scopes: [] }).success,
    ).toBe(false);
  });

  test("an error body refuses an unknown key", () => {
    expect(
      ScoutDesktopApiErrorSchema.safeParse({
        error: "not_found",
        message: "Conversation not found.",
        detail: "extra",
      }).success,
    ).toBe(false);
  });
});
