import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ExploreSuggestionChips } from "#src/components/explore/explore-suggestion-chips.tsx";
import { TRPCProvider, trpcClient } from "#src/lib/trpc.ts";

function renderChips(onSelect = vi.fn()): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ExploreSuggestionChips onSelect={onSelect} />
      </TRPCProvider>
    </QueryClientProvider>,
  );
}

describe("ExploreSuggestionChips", () => {
  test("renders the explore description, shuffle button, and chips", () => {
    const markup = renderChips();
    expect(markup).toContain(
      "Ask about champions, queues, positions, patches, or players",
    );
    expect(markup).not.toContain("League ladder");
    expect(markup).toContain("Shuffle");
    expect(markup).toContain('aria-label="Show different suggestions"');
    expect(markup).toContain("scout-button--outline");
  });

  test("renders prompt options including persistent what can you do", () => {
    const markup = renderChips();
    expect(markup).toContain("What can you do?");
    expect(markup).toContain("?");
  });
});
