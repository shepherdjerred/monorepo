import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
} from "#shared/movie-editions/registry.ts";
import { MovieEditionContextV3Schema } from "#shared/movie-editions/view.ts";
import { movieRequest, submitMovieRequest } from "./api.ts";

const mediaId = "10000000-0000-4000-8000-000000000001";
const subjectUserId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";

function context() {
  return MovieEditionContextV3Schema.parse({
    schemaVersion: 3,
    mediaId,
    subjectUserId,
    access: "detail",
    mediaVersion: 8,
    registryVersion: 1,
    pendingDemands: [],
    options: MovieEditionKeySchema.options.map((edition) => ({
      edition,
      definitionVersion: 0,
      definitionDigest: "a".repeat(64),
      displayLabel: MOVIE_EDITION_REGISTRY[edition].displayLabel,
      policy: MOVIE_EDITION_REGISTRY[edition].policy,
      storedDefinition: null,
      targetVersion: edition === "default" ? 19 : null,
      request:
        edition === "default"
          ? { id: requestId, version: 9, choiceRevision: 4, choiceId: null }
          : null,
      acquisition: edition === "default" ? "eligible" : "protected",
      reasons: edition === "default" ? [] : ["edition_acquisition_not_ready"],
    })),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("movie request review", () => {
  it("binds the explicitly selected named scope without borrowing default CAS or inventing a choice", () => {
    const reviewed = context();
    const named = movieRequest(reviewed, "theatrical_cut", "en, zh-CN");
    expect(named.selection.edition).toBe("theatrical_cut");
    expect(named.expected).toEqual({
      mediaVersion: 8,
      targetVersion: null,
      definition: null,
      request: null,
    });
    expect(named.subjectUserId).toBe(subjectUserId);
    expect(named.options.subtitleLanguages).toEqual(["en", "zh-CN"]);
    const unmarked = movieRequest(reviewed, "default", "en");
    expect(unmarked.expected.request).toEqual({
      id: requestId,
      version: 9,
      choiceRevision: 4,
    });
    reviewed.mediaVersion = 10;
    expect(named.expected.mediaVersion).toBe(8);
    expect(unmarked.expected.targetVersion).toBe(19);
  });

  it("surfaces the actual conflict without refreshing or resubmitting the user's command", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    vi.stubGlobal("document", { cookie: "media-csrf=fixture" });
    const calls: { url: string; input: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, input: RequestInit) => {
      calls.push({ url, input });
      return Promise.resolve(
        Response.json(
          {
            error: {
              code: "version_conflict",
              message: "Review changed movie choices",
            },
          },
          { status: 409 },
        ),
      );
    });
    const input = movieRequest(context(), "default", "en");
    await expect(
      submitMovieRequest(subjectUserId, input),
    ).rejects.toMatchObject({ status: 409, code: "version_conflict" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/v3/media/${mediaId}/movie-requests`);
    expect(calls[0]?.input.body).toBe(JSON.stringify(input));
  });
});
