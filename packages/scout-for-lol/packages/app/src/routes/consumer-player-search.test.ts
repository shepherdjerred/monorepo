import { describe, expect, test } from "vitest";
import {
  isConsumerTypeaheadReady,
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

describe("consumer player search authorization cache", () => {
  test("does not retain protected search responses after the query changes", () => {
    expect(PROTECTED_CONSUMER_SEARCH_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    });
  });
});
