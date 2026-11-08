import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "#client/api.ts";
import { movieRequestV4 } from "./request-api-v4.ts";
import { reviewMovieActivationV4 } from "./activation-v4.tsx";
import {
  movieLifecycleCommandV4,
  movieLifecycleRetryV4,
  readMovieTargetV4,
} from "./target-api-v4.ts";
import { MovieTargetContextV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  movieV4ChoiceContext,
  movieV4Ids,
  movieV4SavedRequest,
  movieV4Scope,
  movieV4Target,
} from "./v4-test-support.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates new v4 consent only for the explicit edition using its own CAS", () => {
  const context = movieV4ChoiceContext();
  const input = movieRequestV4(context, "directors_cut", "en, zh-CN");
  expect(input.schemaVersion).toBe(4);
  expect(input.selection.edition).toBe("directors_cut");
  expect(input.expected).toEqual({
    mediaVersion: 8,
    targetVersion: 11,
    definition: null,
    request: { id: movieV4Ids.request, version: 3, choiceRevision: 2 },
  });
  context.mediaVersion++;
  expect(input.expected.mediaVersion).toBe(8);
  expect(input.options.subtitleLanguages).toEqual(["en", "zh-CN"]);
});

it("activates the same reviewed immutable choice and rejects changed consent without a write", async () => {
  const context = movieV4ChoiceContext();
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    expect(url).toBe(
      `/api/v4/media/${movieV4Ids.media}/movie-edition-context?subjectUserId=${movieV4Ids.subject}`,
    );
    expect(init.method).toBeUndefined();
    return Promise.resolve(Response.json(context));
  });
  vi.stubGlobal("fetch", fetcher);
  const request = movieV4SavedRequest();
  const input = await reviewMovieActivationV4(request, movieV4Ids.subject);
  expect(input).toEqual({
    schemaVersion: 4,
    scope: movieV4Scope,
    subjectUserId: movieV4Ids.subject,
    requestId: movieV4Ids.request,
    choiceId: movieV4Ids.choice,
    expected: {
      mediaVersion: 8,
      targetVersion: 11,
      requestVersion: 3,
      choiceRevision: 2,
    },
  });
  const choice = context.options.find(
    (option) => option.edition === "directors_cut",
  )?.request;
  if (choice == null)
    throw new Error("Test requires the reviewed saved choice");
  choice.choiceRevision++;
  await expect(
    reviewMovieActivationV4(request, movieV4Ids.subject),
  ).rejects.toMatchObject({ status: 409, code: "movie_choice_changed" });
  expect(fetcher.mock.calls).toHaveLength(2);
});

it("keeps the reviewed removal snapshot and CAS when current details change", () => {
  const context = movieV4Target();
  if (context.access !== "detail" || context.removalConfirmation === null)
    throw new Error("Owner review required");
  const input = movieLifecycleCommandV4(context, {
    action: "remove",
    confirmation: context.removalConfirmation,
  });
  context.expected.targetVersion++;
  context.removalConfirmation.fileSetHash = "c".repeat(64);
  expect(input.expected.targetVersion).toBe(11);
  expect(input.command).toMatchObject({
    action: "remove",
    confirmation: { fileSetHash: "a".repeat(64) },
  });
  const retry = movieLifecycleRetryV4({
    error: new Error("response lost after commit"),
    variables: input,
  });
  expect(retry).toBe(input);
  expect(
    movieLifecycleRetryV4({
      error: new ApiError("version_conflict", "Review", 409),
      variables: input,
    }),
  ).toBeNull();
});

it("explains a currently protected activation before sending any command", async () => {
  const context = movieV4ChoiceContext();
  const selected = context.options.find(
    (option) => option.edition === "directors_cut",
  );
  if (selected === undefined) throw new Error("Test requires a current choice");
  selected.acquisition = "protected";
  selected.reasons = ["runtime_protected"];
  const fetcher = vi.fn((url: string) => {
    expect(url).toContain("movie-edition-context");
    return Promise.resolve(Response.json(context));
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    reviewMovieActivationV4(movieV4SavedRequest(), movieV4Ids.subject),
  ).rejects.toMatchObject({
    status: 503,
    code: "movie_activation_protected",
    message: "Media ownership must be confirmed before downloads can start.",
  });
  expect(fetcher.mock.calls).toHaveLength(1);
});

it("allows a protection-only Keep while refusing restore and acquisition", () => {
  const context = MovieTargetContextV4Schema.parse({
    schemaVersion: 4,
    scope: movieV4Scope,
    access: "protection_only",
    expected: { mediaVersion: 8, targetVersion: 11 },
    ownRequests: [],
    ownHold: null,
    allowedProtectiveActions: ["keep"],
  });
  expect(movieLifecycleCommandV4(context, { action: "keep" }).scope).toEqual(
    movieV4Scope,
  );
  expect(() => movieLifecycleCommandV4(context, { action: "restore" })).toThrow(
    ApiError,
  );
  expect(() => movieLifecycleCommandV4(context, { action: "retry" })).toThrow(
    ApiError,
  );
});

it("rejects a valid response for another cut rather than displaying borrowed controls", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(movieV4Target())));
  await expect(
    readMovieTargetV4(movieV4Ids.media, "theatrical_cut"),
  ).rejects.toThrow("Movie controls belong to another edition");
});
