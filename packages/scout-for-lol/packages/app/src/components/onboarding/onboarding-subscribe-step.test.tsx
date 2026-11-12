import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { TRPCProvider } from "#src/lib/query/trpc.ts";
import {
  createStoryQueryClient,
  storyTrpcClient,
} from "#src/lib/storybook/trpc-stub.ts";
import {
  OnboardingSubscribeStep,
  type OnboardingSelfSubscription,
} from "#src/components/onboarding/onboarding-subscribe-step.tsx";

const GUILD_ID = DiscordGuildIdSchema.parse("377554990325301252");
const REPORTS_CHANNEL = DiscordChannelIdSchema.parse("1102938475610293847");
const CHANNELS = [{ id: REPORTS_CHANNEL, name: "match-reports" }];
const SUGGESTIONS_LOADING = "Looking at your recent games for friends";

function noop(): void {
  // Inert step callbacks.
}

/** The step's unsaved-form guard calls useBlocker, which needs a data router. */
function renderWithProviders(element: ReactNode): string {
  const queryClient = createStoryQueryClient([]);
  const router = createMemoryRouter([{ path: "*", element }]);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={storyTrpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>,
  );
}

function renderAddFriends(self: OnboardingSelfSubscription | null): string {
  return renderWithProviders(
    <OnboardingSubscribeStep
      mode="more"
      guildId={GUILD_ID}
      channels={CHANNELS}
      username=""
      discordId=""
      existingSubs={[]}
      self={self}
      onAdded={noop}
      onContinue={noop}
      onBack={noop}
      onSkip={noop}
    />,
  );
}

describe("OnboardingSubscribeStep add-friends", () => {
  test("renders without suggestions when the self step was skipped", () => {
    const markup = renderAddFriends(null);

    expect(markup).toContain("Add friends");
    expect(markup).toContain("Add friend");
    expect(markup).not.toContain(SUGGESTIONS_LOADING);
  });

  test("anchors suggestions on the tracked self subscription", () => {
    const markup = renderAddFriends({
      alias: "sjerred",
      channelId: REPORTS_CHANNEL,
    });

    expect(markup).toContain(SUGGESTIONS_LOADING);
  });
});
