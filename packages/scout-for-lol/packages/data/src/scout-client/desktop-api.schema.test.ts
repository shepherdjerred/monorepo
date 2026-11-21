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
import modelsFixture from "./desktop-fixtures/explore-models.json" with { type: "json" };
import setLeafFixture from "./desktop-fixtures/explore-conversations-set-leaf.json" with { type: "json" };
import shareFixture from "./desktop-fixtures/explore-conversations-share.json" with { type: "json" };
import revokeShareFixture from "./desktop-fixtures/explore-conversations-revoke-share.json" with { type: "json" };
import uploadFixture from "./desktop-fixtures/explore-attachments-upload.json" with { type: "json" };
import discardFixture from "./desktop-fixtures/explore-attachments-discard.json" with { type: "json" };
import coachReviewFixture from "./desktop-fixtures/coach-reviews-get.json" with { type: "json" };
import startAppFixture from "./desktop-fixtures/explore-runs-start-app.json" with { type: "json" };
import coachGetFixture from "./desktop-fixtures/explore-conversations-get-coach.json" with { type: "json" };
import startActionsFixture from "./desktop-fixtures/explore-runs-start-actions.json" with { type: "json" };
import voiceTurnFixture from "./desktop-fixtures/coach-voice-turns.json" with { type: "json" };
import { ScoutClientCreatePairingSchema } from "./protocol.schema.ts";
import { ScoutDesktopAppTurnRequestSchema } from "./coach-context.schema.ts";
import {
  ExploreActiveRunSchema,
  ExploreRunObserveRequestSchema,
  ExploreRunOutcomeResultSchema,
} from "#src/model/reports/explore.ts";
import { EXPLORE_ATTACHMENT_MAX_BYTES } from "#src/model/reports/explore-attachment.ts";
import {
  EXPLORE_MODEL_OPTIONS,
  ExploreModelSchema,
} from "#src/model/reports/explore-model.ts";
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
  ScoutDesktopAttachmentDiscardRequestSchema,
  ScoutDesktopAttachmentUploadRequestSchema,
  ScoutDesktopAttachmentUploadResponseSchema,
  ScoutDesktopConversationGetRequestSchema,
  ScoutDesktopConversationGetResponseSchema,
  ScoutDesktopCoachReviewRequestSchema,
  ScoutDesktopCoachReviewResponseSchema,
  ScoutDesktopModelsResponseSchema,
  ScoutDesktopOkResponseSchema,
  ScoutDesktopSetLeafRequestSchema,
  ScoutDesktopShareResponseSchema,
  ScoutDesktopConversationListRequestSchema,
  ScoutDesktopConversationListResponseSchema,
  ScoutDesktopExploreStatusRequestSchema,
  ScoutDesktopExploreStatusResponseSchema,
  ScoutDesktopEmptyRequestSchema,
  ScoutDesktopPairingV2ResponseSchema,
  ScoutDesktopScopeRequestResponseSchema,
  ScoutDesktopScopeRequestSchema,
  ScoutDesktopRunActiveResponseSchema,
  ScoutDesktopConversationGetResponseSchema as CoachTranscriptSchema,
  ScoutDesktopRunStartRequestSchema,
  ScoutDesktopRunStopResponseSchema,
  ScoutDesktopRunStreamResponseSchema,
  ScoutDesktopScopeSchema,
  type ScoutDesktopApiRoute,
} from "./desktop-api.schema.ts";
import {
  SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES,
  SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES,
  SCOUT_DESKTOP_VOICE_TURN,
  SCOUT_DESKTOP_VOICE_TURN_EVENT_TYPES,
  SCOUT_DESKTOP_VOICE_TURN_MAX_BYTES,
  ScoutDesktopVoiceTurnErrorCodeSchema,
  ScoutDesktopVoiceTurnRequestSchema,
  ScoutDesktopVoiceTurnStreamResponseSchema,
} from "./desktop-voice.schema.ts";
import { COACH_GAME_CONTEXT_MAX_BYTES } from "./coach-context.schema.ts";

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
    request: ScoutDesktopRunStartRequestSchema,
    response: ExploreActiveRunSchema,
    fixture: startFixture,
  },
  explore_runs_start_app: {
    request: ScoutDesktopAppTurnRequestSchema,
    response: ExploreActiveRunSchema,
    fixture: startAppFixture,
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
  explore_models: {
    request: ScoutDesktopEmptyRequestSchema,
    response: ScoutDesktopModelsResponseSchema,
    fixture: modelsFixture,
  },
  explore_conversations_set_leaf: {
    request: ScoutDesktopSetLeafRequestSchema,
    response: ScoutDesktopOkResponseSchema,
    fixture: setLeafFixture,
  },
  explore_conversations_share: {
    request: ScoutDesktopConversationGetRequestSchema,
    response: ScoutDesktopShareResponseSchema,
    fixture: shareFixture,
  },
  explore_conversations_revoke_share: {
    request: ScoutDesktopConversationGetRequestSchema,
    response: ScoutDesktopOkResponseSchema,
    fixture: revokeShareFixture,
  },
  explore_attachments_upload: {
    request: ScoutDesktopAttachmentUploadRequestSchema,
    response: ScoutDesktopAttachmentUploadResponseSchema,
    fixture: uploadFixture,
  },
  explore_attachments_discard: {
    request: ScoutDesktopAttachmentDiscardRequestSchema,
    response: ScoutDesktopOkResponseSchema,
    fixture: discardFixture,
  },
  coach_voice_turns: {
    request: ScoutDesktopVoiceTurnRequestSchema,
    response: ScoutDesktopVoiceTurnStreamResponseSchema,
    fixture: voiceTurnFixture,
  },
  coach_reviews_get: {
    request: ScoutDesktopCoachReviewRequestSchema,
    response: ScoutDesktopCoachReviewResponseSchema,
    fixture: coachReviewFixture,
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

  test("only the run stream and voice turns answer with an event stream", () => {
    const streaming = routeNames.filter(
      (name) => SCOUT_DESKTOP_API_ROUTES[name].response === "event-stream",
    );
    expect(streaming).toEqual(["explore_runs_stream", "coach_voice_turns"]);
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

  test("editing, regenerating, images and a live game are runs/start bodies", () => {
    expect(startActionsFixture.route).toBe("explore_runs_start");
    for (const { flow, request } of startActionsFixture.requests) {
      expect(ScoutDesktopRunStartRequestSchema.parse(request), flow).toEqual(
        request,
      );
    }
    for (const { reason, body } of startActionsFixture.invalidRequests) {
      expect(
        ScoutDesktopRunStartRequestSchema.safeParse(body).success,
        reason,
      ).toBe(false);
    }
  });

  test("a coach answer's options survive the transcript, and a pre-7 message without them still parses", () => {
    const transcript = CoachTranscriptSchema.parse(coachGetFixture.response);
    const answer = transcript.messages.find(
      (message) => message.role === "assistant",
    );
    expect(answer?.coachOptions).toHaveLength(3);
    const { coachOptions: _dropped, ...older } = coachGetFixture.response
      .messages[1] ?? { coachOptions: null };
    expect(
      CoachTranscriptSchema.parse({
        ...coachGetFixture.response,
        messages: [coachGetFixture.response.messages[0], older],
      }).messages[1]?.coachOptions,
    ).toBeNull();
  });

  test("the model list is the web picker's list, and a model outside it is refused", () => {
    expect(ExploreModelSchema.options).toEqual(
      EXPLORE_MODEL_OPTIONS.map((option) => option.id),
    );
    const models = ScoutDesktopModelsResponseSchema.parse(
      modelsFixture.response,
    );
    expect(models.models).toEqual([...EXPLORE_MODEL_OPTIONS]);
  });

  test("an upload holds the web's size cap", () => {
    expect(EXPLORE_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    const tooLong = "A".repeat(
      4 * Math.ceil(EXPLORE_ATTACHMENT_MAX_BYTES / 3) + 4,
    );
    expect(
      ScoutDesktopAttachmentUploadRequestSchema.safeParse({
        mediaType: "image/png",
        base64: tooLong,
      }).success,
    ).toBe(false);
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

describe("Scout desktop voice turn contract", () => {
  test("the voice vocabulary is the contract's, and the golden turn holds every event", () => {
    expect(SCOUT_DESKTOP_VOICE_TURN).toEqual(rawContract.voiceTurn);
    expect(SCOUT_DESKTOP_VOICE_TURN_EVENT_TYPES).toEqual(
      rawContract.voiceTurn.events,
    );
    expect(ScoutDesktopVoiceTurnErrorCodeSchema.options).toEqual(
      rawContract.voiceTurn.errors,
    );
    const types = ScoutDesktopVoiceTurnStreamResponseSchema.parse(
      voiceTurnFixture.response,
    ).events.map((event) => event.type);
    expect(types).toEqual(rawContract.voiceTurn.events);
    for (const { flow, events } of voiceTurnFixture.refusals) {
      const parsed = ScoutDesktopVoiceTurnStreamResponseSchema.parse({
        events,
      }).events;
      expect(parsed.at(-1), flow).toEqual({ type: "done", outcome: "refused" });
      expect(
        parsed.some((event) => event.type === "run"),
        flow,
      ).toBe(false);
    }
  });

  test("the voice caps are one 16 kHz mono PCM16 utterance of at most 15 seconds", () => {
    expect(SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES).toBe(44 + 15 * 16_000 * 2);
    expect(SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES).toBe(44 + 0.2 * 16_000 * 2);
    const golden = Buffer.from(voiceTurnFixture.request.audio.base64, "base64");
    expect(golden.byteLength).toBe(SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES);
    expect(SCOUT_DESKTOP_VOICE_TURN_MAX_BYTES).toBeGreaterThan(
      COACH_GAME_CONTEXT_MAX_BYTES +
        (4 * SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES) / 3,
    );
    const tooLong = "A".repeat(
      4 * Math.ceil(SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES / 3) + 4,
    );
    expect(
      ScoutDesktopVoiceTurnRequestSchema.safeParse({
        trigger: "push_to_talk",
        conversationId: null,
        audio: { mediaType: "audio/wav", base64: tooLong },
      }).success,
    ).toBe(false);
  });
});
