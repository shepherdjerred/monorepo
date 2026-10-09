import { DiscordChannelIdSchema } from "@scout-for-lol/data";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  ChannelAvailabilityMessage,
  channelAvailabilityForQuery,
  channelSelectDisabled,
  channelSelectOptions,
} from "#src/components/channel-select-support.tsx";

const channels = [
  { id: DiscordChannelIdSchema.parse("100000000000000010"), name: "general" },
];

describe("channel availability", () => {
  test("reports pending, failed, empty, and ready channel queries", () => {
    expect(
      channelAvailabilityForQuery({
        isPending: true,
        error: null,
        data: undefined,
      }),
    ).toEqual({ status: "loading" });
    expect(
      channelAvailabilityForQuery({
        isPending: false,
        error: new Error("Discord timed out"),
        data: undefined,
      }),
    ).toEqual({ status: "error", message: "Discord timed out" });
    expect(
      channelAvailabilityForQuery({
        isPending: false,
        error: null,
        data: [],
      }),
    ).toEqual({ status: "empty" });
    expect(
      channelAvailabilityForQuery({
        isPending: false,
        error: null,
        data: channels,
      }),
    ).toEqual({ status: "ready" });
  });

  test("keeps an unavailable saved channel visible without offering it", () => {
    expect(channelSelectOptions("archived", channels)).toEqual([
      {
        value: "archived",
        label: "Current channel (archived)",
        disabled: true,
      },
      { value: "100000000000000010", label: "#general" },
    ]);
    expect(channelSelectOptions("100000000000000010", channels)).toEqual([
      { value: "100000000000000010", label: "#general" },
    ]);
  });

  test("disables a channel picker while loading or without options", () => {
    expect(channelSelectDisabled({ status: "loading" }, 1)).toBe(true);
    expect(channelSelectDisabled({ status: "empty" }, 0)).toBe(true);
    expect(channelSelectDisabled({ status: "error" }, 1)).toBe(false);
    expect(channelSelectDisabled({ status: "ready" }, 0)).toBe(true);
  });

  test("renders channel errors with an accessible retry action", () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(
      <ChannelAvailabilityMessage
        availability={{ status: "error", message: "Discord timed out" }}
        onRetry={onRetry}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Discord timed out");
    expect(markup).toContain(">Retry</button>");
    expect(onRetry).not.toHaveBeenCalled();
  });
});
