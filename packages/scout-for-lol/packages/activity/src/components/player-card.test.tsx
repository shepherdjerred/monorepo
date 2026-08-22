import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NightPlayerCard } from "@/components/player-card";

afterEach(cleanup);

describe("NightPlayerCard", () => {
  test("is a keyboard-operable selection control", async () => {
    const user = userEvent.setup();
    let selected = false;
    render(
      <NightPlayerCard
        participant={{
          discordId: "123",
          displayName: "Ahri Main",
          avatarUrl: null,
          role: "MEMBER",
          availability: "READY",
          readyAt: "2026-08-15T20:00:00.000Z",
          awayUntil: null,
          awayOverdue: false,
          held: false,
          consentedAt: "2026-08-15T20:00:00.000Z",
          playerId: 1,
          playerAlias: "ahri-main",
          accounts: [],
          selectedAccountId: null,
        }}
        selected={selected}
        onSelect={() => {
          selected = true;
        }}
      />,
    );
    const card = screen.getByRole("button", { name: /Ahri Main/u });
    card.focus();
    await user.keyboard(" ");
    expect(selected).toBe(true);
  });
});
