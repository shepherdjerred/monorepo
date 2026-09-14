import { expect, test } from "@playwright/test";
import {
  expectStoryAccessible,
  loadStorybookStories,
  mountStory,
} from "@scout-for-lol/design-system/storybook/e2e";

const stories = await loadStorybookStories(
  new URL("../storybook-static/index.json", import.meta.url),
);

// One theme, deliberately. The design-system suite already sweeps both skins
// and both modes over the primitives these screens are built from, so what is
// left to check here is composition and data state — neither of which varies
// by theme. A second combination would double the lane for no new signal.
const theme = { skin: "modern", mode: "dark" } as const;

for (const story of stories) {
  test(story.id, async ({ page }) => {
    const pageErrors = await mountStory(page, { id: story.id, ...theme });
    await expectStoryAccessible(page);
    // Assert last: a delayed pageerror raised during the axe pass, or by a
    // late effect, still fails the test rather than one thrown before this
    // point only.
    expect(pageErrors).toEqual([]);
  });
}
