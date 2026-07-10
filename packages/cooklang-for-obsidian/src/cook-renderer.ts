import type { ParsedRecipe, Section, StepToken } from "./cook-parser.ts";
import type { CooklangSettings } from "./settings.ts";

/** Render a parsed recipe into an HTML container using Obsidian's createEl API. */
export function renderRecipe(
  container: HTMLElement,
  recipe: ParsedRecipe,
  settings: CooklangSettings,
): void {
  container.empty();
  container.addClass("cook-recipe");

  renderMetadata(container, recipe);
  renderImage(container, recipe);

  const body = container.createDiv({ cls: "cook-body" });

  // If there are sections, render each section
  if (recipe.sections.length > 0) {
    for (const section of recipe.sections) {
      renderSection(body, section, recipe, settings);
    }
  }
}

/** Read a metadata field, returning undefined for absent or empty values. */
function field(
  metadata: ParsedRecipe["metadata"],
  key: string,
): string | undefined {
  const value = metadata[key];
  return value !== undefined && value !== "" ? value : undefined;
}

function renderMetadata(container: HTMLElement, recipe: ParsedRecipe): void {
  const { metadata } = recipe;
  if (Object.keys(metadata).length === 0) return;

  const card = container.createDiv({ cls: "cook-metadata-card" });

  // Title
  const title = field(metadata, "title");
  if (title !== undefined) {
    card.createEl("h1", { text: title, cls: "cook-title" });
  }

  // Description
  const description = field(metadata, "description");
  if (description !== undefined) {
    card.createEl("p", { text: description, cls: "cook-description" });
  }

  // Info row
  const infoRow = card.createDiv({ cls: "cook-info-row" });

  const servings = field(metadata, "servings");
  if (servings !== undefined) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "🍽", cls: "cook-info-icon" });
    tag.createSpan({ text: servings });
  }

  const prepTime = field(metadata, "time.prep");
  if (prepTime !== undefined) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "⏱", cls: "cook-info-icon" });
    tag.createSpan({ text: `Prep: ${prepTime}` });
  }

  const cookTime = field(metadata, "time.cook");
  if (cookTime !== undefined) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "🔥", cls: "cook-info-icon" });
    tag.createSpan({ text: `Cook: ${cookTime}` });
  }

  const totalTime = field(metadata, "time.total");
  if (totalTime !== undefined) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "⏰", cls: "cook-info-icon" });
    tag.createSpan({ text: `Total: ${totalTime}` });
  }

  // Source link
  const sourceUrl = field(metadata, "source.url");
  const source = field(metadata, "source");
  if (sourceUrl !== undefined) {
    const link = card.createEl("a", {
      text: source ?? sourceUrl,
      href: sourceUrl,
      cls: "cook-source-link external-link",
    });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener");
  } else if (source !== undefined) {
    card.createEl("span", { text: `Source: ${source}`, cls: "cook-source" });
  }

  // Author
  const author = field(metadata, "source.author");
  if (author !== undefined) {
    card.createEl("span", { text: `by ${author}`, cls: "cook-author" });
  }

  // Cuisine / Category
  const cuisine = field(metadata, "cuisine");
  const category = field(metadata, "category");
  if (cuisine !== undefined || category !== undefined) {
    const tags = card.createDiv({ cls: "cook-tags" });
    if (cuisine !== undefined)
      tags.createSpan({ text: cuisine, cls: "cook-tag" });
    if (category !== undefined)
      tags.createSpan({ text: category, cls: "cook-tag" });
  }
}

function renderImage(container: HTMLElement, recipe: ParsedRecipe): void {
  const imageUrl = field(recipe.metadata, "image.url");
  if (imageUrl !== undefined) {
    const imgWrapper = container.createDiv({ cls: "cook-image-wrapper" });
    imgWrapper.createEl("img", {
      attr: { src: imageUrl, alt: field(recipe.metadata, "title") ?? "Recipe" },
      cls: "cook-image",
    });
  }
}

function renderSection(
  container: HTMLElement,
  section: Section,
  recipe: ParsedRecipe,
  settings: CooklangSettings,
): void {
  const sectionEl = container.createDiv({ cls: "cook-section" });

  if (section.name) {
    sectionEl.createEl("h2", {
      text: section.name,
      cls: "cook-section-header",
    });
  }

  const isIngredients = /ingredients/i.test(section.name);
  const isDirections = /directions|instructions|steps|method/i.test(
    section.name,
  );
  const isNutrition = /nutrition/i.test(section.name);

  if (isNutrition && !settings.showNutrition) return;

  if (isIngredients) {
    renderIngredientsList(sectionEl, section, settings);
  } else if (isDirections) {
    renderDirections(sectionEl, section, recipe, settings);
  } else {
    // Generic section
    for (const step of section.steps) {
      const p = sectionEl.createEl("p", { cls: "cook-step" });
      renderTokens(p, step.tokens, settings);
    }
  }
}

function renderIngredientsList(
  container: HTMLElement,
  section: Section,
  settings: CooklangSettings,
): void {
  const list = container.createEl("ul", { cls: "cook-ingredients-list" });

  for (const step of section.steps) {
    // Check if this step contains an ingredient token
    const hasIngredient = step.tokens.some(
      (t) => t.type === "ingredient" && t.ref != null && "quantity" in t.ref,
    );

    if (!hasIngredient) {
      // Sub-header or plain text (no ingredient token in this step)
      const li = list.createEl("li", { cls: "cook-ingredient-subheader" });
      li.createEl("strong", { text: step.raw });
      continue;
    }

    // Render as a single ingredient line with all tokens
    const li = list.createEl("li", { cls: "cook-ingredient-item" });

    if (settings.showCheckboxes) {
      const checkbox = li.createEl("input", { cls: "cook-checkbox" });
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        li.toggleClass("cook-checked", checkbox.checked);
      });
    }

    for (const token of step.tokens) {
      renderIngredientToken(li, token);
    }
  }
}

function renderIngredientToken(li: HTMLElement, token: StepToken): void {
  if (token.type === "ingredient" && token.ref && "quantity" in token.ref) {
    const ref = token.ref;
    if (ref.quantity || ref.units) {
      const qty = li.createSpan({ cls: "cook-quantity" });
      if (ref.quantity) qty.createSpan({ text: ref.quantity });
      if (ref.units) qty.createSpan({ text: " " + ref.units });
      li.createSpan({ text: " " });
    }
    li.createSpan({ text: ref.name, cls: "cook-ingredient-name" });
  } else {
    // Trailing text like ", cut into 1/4-inch squares"
    li.createSpan({ text: token.value, cls: "cook-ingredient-extra" });
  }
}

function renderDirections(
  container: HTMLElement,
  section: Section,
  _recipe: ParsedRecipe,
  settings: CooklangSettings,
): void {
  const dirEl = container.createDiv({ cls: "cook-directions" });

  let stepNum = 0;
  for (const step of section.steps) {
    stepNum++;
    const stepEl = dirEl.createDiv({ cls: "cook-direction-step" });
    stepEl.createSpan({ text: String(stepNum), cls: "cook-step-number" });
    const content = stepEl.createDiv({ cls: "cook-step-content" });
    const p = content.createEl("p");
    // Strip leading "N. " prefix from first text token since we add step numbers
    const tokens = [...step.tokens];
    const first = tokens[0];
    if (first?.type === "text") {
      const stripped = first.value.replace(/^\d+\.\s+/, "");
      if (stripped !== first.value) {
        tokens[0] = { ...first, value: stripped };
      }
    }
    renderTokens(p, tokens, settings);
  }
}

function renderTokens(
  el: HTMLElement,
  tokens: StepToken[],
  settings: CooklangSettings,
): void {
  for (const token of tokens) {
    switch (token.type) {
      case "ingredient": {
        const span = el.createSpan({ cls: "cook-inline-ingredient" });
        span.createSpan({
          text: token.ref && "name" in token.ref ? token.ref.name : token.value,
        });
        if (
          settings.showInlineQuantities &&
          token.ref &&
          "quantity" in token.ref
        ) {
          const ref = token.ref;
          if (ref.quantity) {
            span.createSpan({
              text: ` (${ref.quantity}${ref.units ? " " + ref.units : ""})`,
              cls: "cook-inline-qty",
            });
          }
        }
        break;
      }
      case "cookware": {
        el.createSpan({
          text: token.ref && "name" in token.ref ? token.ref.name : token.value,
          cls: "cook-inline-cookware",
        });
        break;
      }
      case "timer": {
        el.createSpan({ text: token.value, cls: "cook-inline-timer" });
        break;
      }
      case "text": {
        el.createSpan({ text: token.value });
        break;
      }
    }
  }
}
