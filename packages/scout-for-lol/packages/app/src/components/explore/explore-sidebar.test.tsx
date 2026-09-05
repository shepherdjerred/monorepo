import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ExploreConversationSchema } from "@scout-for-lol/data";
import { ExploreSidebar } from "#src/components/explore/explore-sidebar.tsx";

const conversation = ExploreConversationSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Champion win rates",
  shareToken: null,
  sharedLeafId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

function ignore(): void {
  // Static accessibility rendering does not invoke interaction callbacks.
}

describe("ExploreSidebar", () => {
  test("labels a running conversation accessibly", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ExploreSidebar
          conversations={[conversation]}
          activeId={null}
          onSelect={ignore}
          onNew={ignore}
          onRename={ignore}
          onDelete={ignore}
          statusForConversation={() => "running"}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Champion win rates");
    expect(html).toContain('aria-label="Answer running"');
  });

  test("labels unread completion and failure markers", () => {
    const completed = renderToStaticMarkup(
      <MemoryRouter>
        <ExploreSidebar
          conversations={[conversation]}
          activeId={null}
          onSelect={ignore}
          onNew={ignore}
          onRename={ignore}
          onDelete={ignore}
          statusForConversation={() => "completed"}
        />
      </MemoryRouter>,
    );
    const failed = renderToStaticMarkup(
      <MemoryRouter>
        <ExploreSidebar
          conversations={[conversation]}
          activeId={null}
          onSelect={ignore}
          onNew={ignore}
          onRename={ignore}
          onDelete={ignore}
          statusForConversation={() => "failed"}
        />
      </MemoryRouter>,
    );

    expect(completed).toContain('aria-label="New answer available"');
    expect(failed).toContain('aria-label="Answer needs attention"');
  });
});
