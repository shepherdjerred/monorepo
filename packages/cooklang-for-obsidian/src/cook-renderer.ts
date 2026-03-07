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

function renderMetadata(container: HTMLElement, recipe: ParsedRecipe): void {
  const { metadata } = recipe;
  if (Object.keys(metadata).length === 0) return;

  const card = container.createDiv({ cls: "cook-metadata-card" });

  // Title
  const title = metadata.title;
  if (title) {
    card.createEl("h1", { text: title, cls: "cook-title" });
  }

  // Description
  const description = metadata.description;
  if (description) {
    card.createEl("p", { text: description, cls: "cook-description" });
  }

  // Info row
  const infoRow = card.createDiv({ cls: "cook-info-row" });

  const servings = metadata.servings;
  if (servings) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "🍽", cls: "cook-info-icon" });
    tag.createSpan({ text: servings });
  }

  const prepTime = metadata["time.prep"];
  if (prepTime) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "⏱", cls: "cook-info-icon" });
    tag.createSpan({ text: `Prep: ${prepTime}` });
  }

  const cookTime = metadata["time.cook"];
  if (cookTime) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "🔥", cls: "cook-info-icon" });
    tag.createSpan({ text: `Cook: ${cookTime}` });
  }

  const totalTime = metadata["time.total"];
  if (totalTime) {
    const tag = infoRow.createDiv({ cls: "cook-info-tag" });
    tag.createSpan({ text: "⏰", cls: "cook-info-icon" });
    tag.createSpan({ text: `Total: ${totalTime}` });
  }

  // Source link
  const sourceUrl = metadata["source.url"];
  const source = metadata.source;
  if (sourceUrl) {
    const link = card.createEl("a", {
      text: source || sourceUrl,
      href: sourceUrl,
      cls: "cook-source-link external-link",
    });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener");
  } else if (source) {
    card.createEl("span", { text: `Source: ${source}`, cls: "cook-source" });
  }

  // Author
  const author = metadata["source.author"];
  if (author) {
    card.createEl("span", { text: `by ${author}`, cls: "cook-author" });
  }

  // Cuisine / Category
  const cuisine = metadata.cuisine;
  const category = metadata.category;
  if (cuisine || category) {
    const tags = card.createDiv({ cls: "cook-tags" });
    if (cuisine) tags.createSpan({ text: cuisine, cls: "cook-tag" });
    if (category) tags.createSpan({ text: category, cls: "cook-tag" });
  }
}

function renderImage(container: HTMLElement, recipe: ParsedRecipe): void {
  const imageUrl = recipe.metadata["image.url"];
  if (imageUrl) {
    const imgWrapper = container.createDiv({ cls: "cook-image-wrapper" });
    imgWrapper.createEl("img", {
      attr: { src: imageUrl, alt: recipe.metadata.title || "Recipe" },
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
    sectionEl.createEl("h2", { text: section.name, cls: "cook-section-header" });
  }

  const isIngredients = /ingredients/i.test(section.name);
  const isDirections = /directions|instructions|steps|method/i.test(section.name);
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
    if (tokens.length > 0 && tokens[0].type === "text") {
      const stripped = tokens[0].value.replace(/^\d+\.\s+/, "");
      if (stripped !== tokens[0].value) {
        tokens[0] = { ...tokens[0], value: stripped };
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
        span.createSpan({ text: token.ref && "name" in token.ref ? token.ref.name : token.value });
        if (settings.showInlineQuantities && token.ref && "quantity" in token.ref) {
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
