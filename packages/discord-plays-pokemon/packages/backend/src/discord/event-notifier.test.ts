import { eventToEmbed } from "./event-notifier.ts";

describe("eventToEmbed", () => {
  test("faint shows title-cased species and level", () => {
    const embed = eventToEmbed({
      kind: "faint",
      species: 277,
      nickname: "MON",
      level: 12,
    });
    expect(embed.data.description).toBe("Treecko (Lv. 12) fainted.");
  });

  test("badge names the badge, leader, and city", () => {
    const embed = eventToEmbed({ kind: "badge", badgeIndex: 0 });
    expect(embed.data.description).toContain("Stone Badge");
    expect(embed.data.description).toContain("Roxanne");
    expect(embed.data.description).toContain("Rustboro City");
  });

  test("evolution names both species", () => {
    const embed = eventToEmbed({
      kind: "evolution",
      fromSpecies: 277,
      toSpecies: 278,
      nickname: "MON",
      level: 16,
    });
    expect(embed.data.description).toBe("Treecko evolved into Grovyle!");
  });

  test("catch marks shiny", () => {
    const shiny = eventToEmbed({ kind: "catch", species: 263, shiny: true });
    expect(shiny.data.description).toContain("Shiny!");
    const plain = eventToEmbed({ kind: "catch", species: 263, shiny: false });
    expect(plain.data.description).not.toContain("Shiny!");
  });

  test("whiteout has a description", () => {
    expect(eventToEmbed({ kind: "whiteout" }).data.description).toContain(
      "blacked out",
    );
  });

  test("dex entry shows number and name", () => {
    const embed = eventToEmbed({ kind: "dexEntry", nationalDexNumber: 252 });
    expect(embed.data.description).toContain("#252");
    expect(embed.data.description).toContain("Treecko");
  });
});
