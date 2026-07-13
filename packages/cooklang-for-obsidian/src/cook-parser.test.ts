import { describe, expect, test } from "bun:test";
import {
  parseRecipe,
  type Ingredient,
  type StepToken,
  type Timer,
} from "./cook-parser.ts";

/** Collect every step token across all sections into a flat array. */
function allTokens(text: string): StepToken[] {
  return parseRecipe(text).sections.flatMap((section) =>
    section.steps.flatMap((step) => step.tokens),
  );
}

describe("parseRecipe — Cooklang markup", () => {
  test("parses a braced ingredient with quantity and unit", () => {
    const recipe = parseRecipe("Add @flour{200%g} to the bowl.");

    expect(recipe.hasCooklangMarkup).toBe(true);
    expect(recipe.ingredients).toEqual([
      { name: "flour", quantity: "200", units: "g" },
    ]);

    const ingredientToken = allTokens("Add @flour{200%g} to the bowl.").find(
      (token) => token.type === "ingredient",
    );
    expect(ingredientToken?.value).toBe("flour");
    expect(ingredientToken?.ref).toEqual({
      name: "flour",
      quantity: "200",
      units: "g",
    });
  });

  test("parses a braced quantity with no unit (no percent)", () => {
    const recipe = parseRecipe("Add @eggs{3}.");

    expect(recipe.ingredients).toEqual([
      { name: "eggs", quantity: "3", units: "" },
    ]);
  });

  test("parses multi-word braced ingredient names", () => {
    const recipe = parseRecipe("Pour @olive oil{2%tbsp} over the top.");

    expect(recipe.ingredients).toEqual([
      { name: "olive oil", quantity: "2", units: "tbsp" },
    ]);
  });

  test("parses a bare single-word ingredient", () => {
    const recipe = parseRecipe("Season with @salt and serve.");

    expect(recipe.ingredients).toEqual([
      { name: "salt", quantity: "", units: "" },
    ]);
  });

  test("parses braced cookware", () => {
    const recipe = parseRecipe("Whisk in a #mixing bowl{} until smooth.");

    expect(recipe.cookware).toEqual([{ name: "mixing bowl" }]);
    const cookwareToken = allTokens(
      "Whisk in a #mixing bowl{} until smooth.",
    ).find((token) => token.type === "cookware");
    expect(cookwareToken?.value).toBe("mixing bowl");
  });

  test("parses a bare single-word cookware", () => {
    const recipe = parseRecipe("Place on a #tray to cool.");

    expect(recipe.cookware).toEqual([{ name: "tray" }]);
  });

  test("parses a timer with quantity and unit", () => {
    const recipe = parseRecipe("Bake for ~{45%minutes}.");

    const expectedTimer: Timer = {
      name: "",
      quantity: "45",
      units: "minutes",
    };
    expect(recipe.timers).toEqual([expectedTimer]);

    const timerToken = allTokens("Bake for ~{45%minutes}.").find(
      (token) => token.type === "timer",
    );
    expect(timerToken?.value).toBe("45 minutes");
  });

  test("parses a named timer", () => {
    const recipe = parseRecipe("Let ~dough rest{1%hour} on the counter.");

    expect(recipe.timers).toEqual([
      { name: "dough rest", quantity: "1", units: "hour" },
    ]);
  });

  test("treats a lone @ (space after) as plain text, not markup", () => {
    // hasCooklangSyntax requires @\w; "@ " has a space after the sigil, so the
    // recipe is routed through the plain-text parser and no ingredient is made.
    const recipe = parseRecipe("Email me @ the address.");

    expect(recipe.hasCooklangMarkup).toBe(false);
    expect(recipe.ingredients).toEqual([]);
  });

  test("treats a stray @ mid-step as text when the recipe already has markup", () => {
    // The recipe has real markup (@salt) so it takes the Cooklang path; the
    // bare "@ " with a trailing space is emitted as plain text, not an ingredient.
    const recipe = parseRecipe("Add @salt then email me @ the address.");

    expect(recipe.hasCooklangMarkup).toBe(true);
    expect(recipe.ingredients).toEqual([
      { name: "salt", quantity: "", units: "" },
    ]);
    const textValues = allTokens("Add @salt then email me @ the address.")
      .filter((token) => token.type === "text")
      .map((token) => token.value)
      .join("");
    expect(textValues).toContain("@");
  });

  test("skips comment and metadata-comment lines in the body", () => {
    const recipe = parseRecipe(
      [
        "-- this is a comment",
        "[- block comment -]",
        "Mix @sugar{1%cup}.",
      ].join("\n"),
    );

    expect(recipe.ingredients).toEqual([
      { name: "sugar", quantity: "1", units: "cup" },
    ]);
    const rawLines = recipe.sections.flatMap((section) =>
      section.steps.map((step) => step.raw),
    );
    expect(rawLines).toEqual(["Mix @sugar{1%cup}."]);
  });

  test("parses YAML frontmatter into metadata", () => {
    const recipe = parseRecipe(
      [
        "---",
        "title: Pancakes",
        "servings: 4",
        "---",
        "Mix @flour{200%g}.",
      ].join("\n"),
    );

    expect(recipe.metadata).toEqual({ title: "Pancakes", servings: "4" });
    expect(recipe.ingredients).toEqual<Ingredient[]>([
      { name: "flour", quantity: "200", units: "g" },
    ]);
  });
});

describe("parseRecipe — plain text", () => {
  test("marks plain recipes as having no Cooklang markup", () => {
    const recipe = parseRecipe("Just cook the food until it is done.");

    expect(recipe.hasCooklangMarkup).toBe(false);
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.cookware).toEqual([]);
    expect(recipe.timers).toEqual([]);
  });
});
