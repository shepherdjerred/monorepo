import { expect, it } from "vitest";
import { harness } from "#activities/promotion/tool-test-support.ts";

it.each([
  { name: "TheStormMC", href: "#" },
  { name: "Edit Server", href: "/server/edit/123" },
  { name: "Submit a new text post", href: "/submit?selftext=true" },
])(
  "preserves native click handlers for a navigation link: %j",
  async ({ name, href }) => {
    const f = await harness();
    f.control.mockResolvedValue({ ref: "e4", role: "link", name });
    f.attribute.mockResolvedValue(href);
    await f.handle({ endpoint: "action", body: { kind: "click", ref: "e4" } });
    expect(f.action).toHaveBeenCalledExactlyOnceWith({
      kind: "click",
      ref: "e4",
    });
    expect(f.open).not.toHaveBeenCalled();
  },
);
it.each([
  { name: "Bump Submission", href: "#" },
  { name: "Delete", href: "/manage/123" },
  { name: "Update", href: "/bump/123" },
  { name: "Submit", href: "#" },
])(
  "blocks an effect link before its native handler can run: %j",
  async ({ name, href }) => {
    const f = await harness();
    f.control.mockResolvedValue({ ref: "e4", role: "link", name });
    f.attribute.mockResolvedValue(href);
    await expect(
      f.handle({ endpoint: "action", body: { kind: "click", ref: "e4" } }),
    ).rejects.toThrow("Read-only");
    expect(f.action).not.toHaveBeenCalled();
  },
);
it("validates the native link target before clicking it", async () => {
  const f = await harness();
  f.control.mockResolvedValue({ ref: "e4", role: "link", name: "Manage" });
  f.attribute.mockResolvedValue("https://outside.invalid/account");
  await expect(
    f.handle({ endpoint: "action", body: { kind: "click", ref: "e4" } }),
  ).rejects.toThrow("scope");
  expect(f.action).not.toHaveBeenCalled();
});
