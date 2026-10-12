import { themeCatalog } from "./catalog.ts";
import type { StormPreferences } from "./preferences.ts";

type Theme = (typeof themeCatalog.themes)[number];
const symbols = {
  snow: "❄",
  hearts: "♥",
  petals: "✿",
  sparks: "•",
  leaves: "",
  ghosts: "",
  confetti: "■",
};

export function applySurface(
  theme: Theme,
  mode: "light" | "dark",
  docs: boolean,
  base: URL,
): void {
  const html = document.documentElement;
  html.dataset["stormTheme"] = theme.id;
  html.dataset["stormMode"] = mode;
  html.dataset["stormSurface"] = docs ? "docs" : "forum";
  const palette = theme.palettes[mode];
  for (const [name, value] of Object.entries(palette))
    html.style.setProperty(
      "--storm-" +
        name.replaceAll(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()),
      value,
    );
  if (docs) applyDocs(theme, mode, base);
  for (const img of document.querySelectorAll<HTMLImageElement>(
    ".stormWelcome img",
  ))
    img.src = new URL(theme.contentLogos[mode], base).href;
}

function applyDocs(theme: Theme, mode: "light" | "dark", base: URL) {
  const html = document.documentElement;
  html.dataset["theme"] = mode;
  html.style.colorScheme = mode;
  const scenery = themeCatalog.scenery[theme.scenery];
  if (scenery === undefined) throw new Error("Missing Storm scenery");
  html.style.setProperty(
    "--storm-scenery",
    `url("${new URL(scenery.desktop, base).href}")`,
  );
  html.style.setProperty(
    "--storm-scenery-mobile",
    `url("${new URL(scenery.mobile, base).href}")`,
  );
  html.style.setProperty(
    "--storm-decoration",
    theme.decoration === null
      ? "none"
      : `url("${new URL(theme.decoration, base).href}")`,
  );
  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]'))
    meta.remove();
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = theme.palettes[mode].metaThemeColor;
  document.head.append(meta);
  for (const img of document.querySelectorAll<HTMLImageElement>(
    "[data-storm-logo]",
  ))
    img.src = new URL(theme.logos[mode], base).href;
}

export function renderEffects(
  layer: HTMLElement,
  theme: Theme,
  settings: { enabled: boolean; reduced: boolean },
): void {
  layer.replaceChildren();
  const animated =
    settings.enabled && !settings.reduced && theme.effect !== null;
  if (!animated || theme.effect === null) return;
  const mobile = matchMedia("(max-width: 800px)").matches;
  const count =
    theme.effect === "ghosts" ? (mobile ? 5 : 12) : mobile ? 12 : 28;
  for (let index = 0; index < count; index++) {
    const particle = document.createElement("span");
    particle.textContent = symbols[theme.effect];
    particle.style.left = `${String((index * 137.508) % 100)}%`;
    particle.style.setProperty(
      "--fall-duration",
      `${String(22 + (index % 13))}s`,
    );
    particle.style.setProperty("--fall-delay", `${String(-index * 1.7)}s`);
    particle.style.fontSize = `${String(10 + (index % 7))}px`;
    particle.dataset["effect"] = theme.effect;
    layer.append(particle);
  }
}

export function syncControls(
  root: ParentNode,
  preferences: StormPreferences,
): void {
  for (const form of root.querySelectorAll<HTMLFormElement>(
    "[data-storm-preferences]",
  )) {
    for (const field of form.querySelectorAll<HTMLSelectElement>("select"))
      field.value =
        field.name === "storm_mode"
          ? preferences.appearance
          : preferences.theme;
    const effects = form.querySelector<HTMLInputElement>(
      'input[name="storm_effects"]',
    );
    if (effects !== null) effects.checked = preferences.effects;
  }
}
