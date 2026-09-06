import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreHeader } from "#src/components/explore/explore-header.tsx";

describe("ExploreHeader", () => {
  test("keeps the mobile conversations trigger in a responsive wrapper", () => {
    const markup = renderToStaticMarkup(
      <ExploreHeader
        title="Explore"
        drawerOpen={false}
        onDrawerOpenChange={(open) => open}
        sidebar={<div>Sidebar</div>}
      />,
    );

    expect(markup).toContain('class="md:hidden"');
    expect(markup).toContain("scout-button--icon-small");
    expect(markup).toContain('aria-label="Conversations"');
    expect(markup).not.toContain("p-0 md:hidden");
  });
});
