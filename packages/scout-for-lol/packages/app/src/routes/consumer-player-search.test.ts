import { Loaded } from "@shepherdjerred/loaded";
import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  isConsumerTypeaheadReady,
  PlayerHome,
  PROTECTED_CONSUMER_SEARCH_QUERY_OPTIONS,
  shouldHideConsumerSuggestions,
} from "#src/routes/consumer-player-search.tsx";

describe("consumer player typeahead", () => {
  test("starts after two trimmed characters", () => {
    expect(isConsumerTypeaheadReady("")).toBe(false);
    expect(isConsumerTypeaheadReady(" n ")).toBe(false);
    expect(isConsumerTypeaheadReady(" no ")).toBe(true);
  });

  test.each([
    {
      label: "the debounce has not settled",
      query: "north",
      debouncedQuery: "no",
      isPlaceholderData: false,
    },
    {
      label: "the new request still carries prior data",
      query: "north",
      debouncedQuery: "north",
      isPlaceholderData: true,
    },
  ])("hides suggestions while $label", (input) => {
    expect(shouldHideConsumerSuggestions(input)).toBe(true);
  });

  test("shows only current settled suggestions", () => {
    expect(
      shouldHideConsumerSuggestions({
        query: " North ",
        debouncedQuery: "North",
        isPlaceholderData: false,
      }),
    ).toBe(false);
  });
});

describe("consumer player hub states", () => {
  test("renders loading, error, and both empty explanations", () => {
    const loading = renderToStaticMarkup(
      createElement(PlayerHome, {
        home: Loaded.loading(),
        onRetry: vi.fn(),
      }),
    );
    expect(loading).toContain("Loading your player hub");

    const error = renderToStaticMarkup(
      createElement(PlayerHome, {
        home: Loaded.failed(new Error("hub unavailable")),
        onRetry: vi.fn(),
      }),
    );
    expect(error).toContain("didn&#x27;t load");

    const empty = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(PlayerHome, {
          home: Loaded.done({ yourProfiles: [], recentPlayers: [] }),
          onRetry: vi.fn(),
        }),
      ),
    );
    expect(empty).toBe("");
    expect(empty).not.toContain("No Scout player is linked");
    expect(empty).not.toContain("Recently active");
  });

  test("keeps a compact note when only one hub list is empty", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(PlayerHome, {
          home: Loaded.done({
            yourProfiles: [
              {
                playerId: 1,
                alias: "North",
                guild: { name: "Scout" },
                accounts: [],
                lastMatchTime: null,
              },
            ],
            recentPlayers: [],
          }),
          onRetry: vi.fn(),
        }),
      ),
    );
    expect(html).toContain("North");
    expect(html).toContain(
      'class="text-sm text-scout-subtle">No other recently active players',
    );
    expect(html).not.toContain("No Scout player is linked");
  });
});

describe("consumer player search authorization cache", () => {
  test("does not retain protected search responses after the query changes", () => {
    expect(PROTECTED_CONSUMER_SEARCH_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    });
  });
});
