import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Game } from "./game.ts";
import { ActivityPanels, Avatar, TrainerPanels } from "./trainer-panels.tsx";
import { pokemonSpriteUrl } from "./pokemon-sprites.ts";

const GAME: Game = {
  connected: true,
  status: null,
  state: {
    phase: "overworld",
    location: "Route 101",
    party: [
      {
        species: "Mudkip",
        nationalDexNumber: 258,
        nickname: "MUDDY",
        level: 7,
        hp: 18,
        maxHp: 22,
        isEgg: false,
      },
      {
        species: "Egg",
        nationalDexNumber: null,
        nickname: "EGG",
        level: 1,
        hp: 0,
        maxHp: 0,
        isEgg: true,
      },
      {
        species: "Zigzagoon",
        nationalDexNumber: 263,
        nickname: "ZIGGY",
        level: 4,
        hp: 0,
        maxHp: 16,
        isEgg: false,
      },
    ],
    badges: [false, false, false, false, false, false, false, false],
    pokedexOwned: 1,
    money: 3000,
    goal: null,
  },
  events: [
    {
      id: "1",
      at: "2026-10-12T19:00:00.000Z",
      event: "catch",
      title: "Caught a Pokémon",
      text: "Caught Mudkip! Shiny!",
      pokemonArtwork: [{ nationalDexNumber: 258, shiny: true }],
    },
    {
      id: "2",
      at: "2026-10-12T19:01:00.000Z",
      event: "evolution",
      title: "Evolution",
      text: "Mudkip evolved into Marshtomp!",
      pokemonArtwork: [
        { nationalDexNumber: 258, shiny: false },
        { nationalDexNumber: 259, shiny: false },
      ],
    },
    {
      id: "3",
      at: "2026-10-12T19:02:00.000Z",
      event: "badge",
      title: "Badge earned",
      text: "Earned the Stone Badge.",
      pokemonArtwork: [],
    },
  ],
  inputs: [],
  notice: null,
};

test("sprite paths use the bundled Emerald asset directory", () => {
  expect(pokemonSpriteUrl(258)).toBe("/pokemon-sprites/emerald/258.png");
  expect(pokemonSpriteUrl(258, true)).toBe(
    "/pokemon-sprites/emerald/shiny/258.png",
  );
  expect(() => pokemonSpriteUrl(0)).toThrow("Invalid Emerald National Dex");
});

test("party cards show sprite, egg, fainted, and empty-slot states", () => {
  const markup = renderToStaticMarkup(<TrainerPanels game={GAME} />);

  expect(markup).toContain(`src="${pokemonSpriteUrl(258)}"`);
  expect(markup).toContain('class="egg-sprite"');
  expect(markup).toContain('class="party-card fainted"');
  expect(markup).toContain('class="party-card "');
  expect(markup).toContain("Empty slot");
});

test("journal illustrates Pokémon events, evolution, shiny catches, and badges", () => {
  const markup = renderToStaticMarkup(<ActivityPanels game={GAME} />);

  expect(markup).toContain(`src="${pokemonSpriteUrl(258, true)}"`);
  expect(markup).toContain(`src="${pokemonSpriteUrl(259)}"`);
  expect(markup).toContain('class="shiny-sparkle"');
  expect(markup).toContain('class="evolution-arrow"');
  expect(markup).toContain('class="event-marker"');
  expect(markup).toContain("Stone Badge");
});

test.each([
  { name: "ash", initial: "A" },
  { name: "😀Ash", initial: "😀" },
  { name: "👨‍👩‍👧‍👦 family", initial: "👨‍👩‍👧‍👦" },
])(
  "default avatar shows the whole first character of $name",
  ({ name, initial }) => {
    const markup = renderToStaticMarkup(
      <Avatar
        user={{
          discordId: "1",
          username: "trainer",
          name,
          avatarUrl: null,
        }}
      />,
    );
    expect(markup).toBe(
      `<span class="avatar avatar-initial" aria-hidden="true">${initial}</span>`,
    );
  },
);
