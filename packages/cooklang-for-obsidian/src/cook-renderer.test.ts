import { describe, expect, test } from "bun:test";
import { parseRecipe } from "./cook-parser.ts";
import { renderRecipe } from "./cook-renderer.ts";
import type { CooklangSettings } from "./settings.ts";

const settings: CooklangSettings = {
  showInlineQuantities: true,
  defaultView: "preview",
  showNutrition: true,
  showCheckboxes: true,
};

/** Parse `text` and render it into a fresh detached container element.
 *  The container is a real HTMLElement; the Obsidian createEl/createDiv/etc.
 *  augmentation is polyfilled by test/setup.ts (see bunfig.toml preload). */
function render(text: string): HTMLElement {
  const container = document.createElement("div");
  renderRecipe(container, parseRecipe(text), settings);
  return container;
}

function textsByClass(container: HTMLElement, cls: string): string[] {
  return [...container.querySelectorAll(`.${cls}`)].map(
    (el) => el.textContent ?? "",
  );
}

describe("renderRecipe — metadata field() behavior", () => {
  test("renders a present title from frontmatter", () => {
    const container = render(
      ["---", "title: Waffles", "---", "Mix @flour{1%cup}."].join("\n"),
    );

    const title = container.querySelector(".cook-title");
    expect(title).not.toBeNull();
    expect(title?.tagName.toLowerCase()).toBe("h1");
    expect(title?.textContent).toBe("Waffles");
  });

  test("omits the title element when the title value is empty", () => {
    // field() returns undefined for empty strings, so no h1 is emitted even
    // though the `title` key is present in the metadata.
    const container = render(
      ["---", "title:", "servings: 2", "---", "Mix @flour{1%cup}."].join("\n"),
    );

    expect(container.querySelector(".cook-title")).toBeNull();
    // A non-empty sibling field still renders, proving the card was created.
    expect(container.querySelector(".cook-metadata-card")).not.toBeNull();
  });

  test("omits the title element when the title key is absent", () => {
    const container = render(
      ["---", "servings: 2", "---", "Mix @flour{1%cup}."].join("\n"),
    );

    expect(container.querySelector(".cook-title")).toBeNull();
    expect(container.querySelector(".cook-metadata-card")).not.toBeNull();
  });

  test("skips the metadata card entirely when there is no metadata", () => {
    const container = render("Mix @flour{1%cup}.");

    expect(container.querySelector(".cook-metadata-card")).toBeNull();
  });
});

describe("renderRecipe — steps and ingredients", () => {
  test("renders a directions section with numbered steps and inline tokens", () => {
    const container = render(
      [
        "= Directions",
        "Whisk @eggs{2} into the #bowl{}.",
        "Bake for ~{20%min}.",
      ].join("\n"),
    );

    expect(container.querySelector(".cook-directions")).not.toBeNull();

    // One step number per direction line, in order.
    expect(textsByClass(container, "cook-step-number")).toEqual(["1", "2"]);

    // Inline ingredient name comes from the parsed ref.
    const ingredientTexts = textsByClass(container, "cook-inline-ingredient");
    expect(ingredientTexts.join(" ")).toContain("eggs");

    // Inline quantity is shown because showInlineQuantities is on.
    expect(textsByClass(container, "cook-inline-qty")).toEqual([" (2)"]);

    // Cookware and timer render their own inline spans.
    expect(textsByClass(container, "cook-inline-cookware")).toEqual(["bowl"]);
    expect(textsByClass(container, "cook-inline-timer")).toEqual(["20 min"]);
  });

  test("hides inline quantities when the setting is disabled", () => {
    const container = document.createElement("div");
    renderRecipe(
      container,
      parseRecipe(["= Directions", "Whisk @eggs{2}."].join("\n")),
      { ...settings, showInlineQuantities: false },
    );

    expect(container.querySelector(".cook-inline-qty")).toBeNull();
    // The ingredient name is still present even without the quantity.
    expect(
      textsByClass(container, "cook-inline-ingredient").join(""),
    ).toContain("eggs");
  });

  test("renders an ingredients section as a list with quantity and name", () => {
    const container = render(
      ["= Ingredients", "Add @butter{100%g}."].join("\n"),
    );

    const list = container.querySelector(".cook-ingredients-list");
    expect(list).not.toBeNull();
    expect(list?.tagName.toLowerCase()).toBe("ul");
    expect(container.querySelector(".cook-ingredient-item")).not.toBeNull();
    expect(textsByClass(container, "cook-ingredient-name")).toEqual(["butter"]);
    expect(textsByClass(container, "cook-quantity").join("")).toContain("100");
  });
});
