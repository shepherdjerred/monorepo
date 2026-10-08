import { mkdir } from "node:fs/promises";
import seed from "#data/seed-catalog.json";
import layout from "#data/layout.json";
import { mix, readable } from "#src/colors.ts";

const root = new URL("../", import.meta.url);
const check = Bun.argv.includes("--check");
const effects: Record<string, string> = {
  newyear: "confetti",
  valentines: "hearts",
  easter: "petals",
  midsummer: "sparks",
  harvest: "leaves",
  halloween: "ghosts",
  thanksgiving: "leaves",
  christmas: "snow",
};
async function output(relative: string, value: string) {
  const file = Bun.file(new URL(relative, root));
  if (check) {
    if (!(await file.exists()) || (await file.text()) !== value)
      throw new Error(`Run storm-theme generate: ${relative} differs`);
  } else {
    await Bun.write(file, value);
  }
}
if (!check) await mkdir(new URL("assets/logos/", root), { recursive: true });
const logo = await Bun.file(new URL("assets/logo.svg", root)).text();
const geometry =
  ":root {\n" +
  Object.entries(layout)
    .map(([name, value]) => {
      if (!Number.isInteger(value) || value <= 0)
        throw new Error("Invalid Storm layout: " + name);
      return (
        "  --storm-" +
        name.replaceAll(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()) +
        ": " +
        String(value) +
        "px;"
      );
    })
    .join("\n") +
  "\n}\n";
await output("src/layout.css", geometry);
await output("assets/layout.css", geometry);
const themes = [];
for (const theme of seed.themes) {
  const palettes = { light: {}, dark: {} };
  for (const mode of ["light", "dark"] as const) {
    const base = theme.palettes[mode],
      dark = mode === "dark";
    const contentBg = dark ? "#2a2a2a" : "#ffffff";
    const contentAltBg = dark ? "#222222" : "#f4f3f0";
    const textColor = dark ? "#ebebeb" : "#333333";
    const chromeBg = base.chromeBg,
      subNavBg = base.subNavBg;
    const contentHighlightBg = mix(base.accent, contentBg, dark ? 0.88 : 0.94);
    const selectedItemBgColor = mix(base.accent, contentBg, dark ? 0.78 : 0.89);
    const buttonPrimaryBg = readable(dark ? chromeBg : base.accent, "#ffffff");
    const buttonCtaBg = base.majorHeadingBg;
    const palette = {
      ...base,
      accent: readable(base.accent, contentBg),
      chromeTextColor: "#ffffff",
      chromeHoverColor: readable(mix(base.accent, "#ffffff", 0.8), chromeBg),
      subNavTextColor: readable(base.subNavTextColor, subNavBg),
      subNavHoverColor: readable("#ffffff", mix(subNavBg, "#000000", 0.13)),
      linkColor: readable(base.linkColor, contentBg),
      linkHoverColor: readable(base.linkHoverColor, contentBg),
      contentBg,
      contentAltBg,
      contentHighlightBg,
      textColor,
      pageBg: contentAltBg,
      minorHeadingTextColor: readable(
        dark ? "#bbbbbb" : "#666666",
        contentAltBg,
      ),
      textColorMuted: readable(dark ? "#bbbbbb" : "#666666", contentAltBg),
      textColorDimmed: readable(dark ? "#bbbbbb" : "#666666", contentBg),
      textColorEmphasized: dark ? "#ffffff" : "#242424",
      textColorFeature: readable(base.linkColor, contentBg),
      borderColor: dark ? "#626262" : "#bdbdbd",
      borderColorLight: dark ? "#454545" : "#dedede",
      borderColorHeavy: dark ? "#929292" : "#757575",
      inputBgColor: dark ? "#1c1c1c" : "#ffffff",
      inputTextColor: dark ? "#ffffff" : "#333333",
      inputBorderColor: dark ? "#929292" : "#757575",
      controlColor: readable(base.accent, dark ? "#1c1c1c" : "#ffffff", 3),
      focusColor: readable(base.accent, contentBg, 3),
      buttonPrimaryBg,
      buttonPrimaryColor: "#ffffff",
      buttonPrimaryHoverBg: mix(buttonPrimaryBg, "#000000", 0.12),
      buttonCtaBg,
      buttonCtaColor: readable(base.majorHeadingTextColor, buttonCtaBg),
      selectedItemBgColor,
      selectedItemColor: readable(base.linkColor, selectedItemBgColor),
      paletteColor1: contentHighlightBg,
      paletteColor2: mix(base.accent, contentBg, dark ? 0.5 : 0.75),
      paletteColor3: readable(base.accent, contentBg, 3),
      paletteColor4: dark
        ? mix(base.accent, "#000000", 0.45)
        : readable(base.accent, "#ffffff"),
      paletteColor5: mix(base.accent, "#000000", 0.55),
      majorHeadingTextColor: readable(
        base.majorHeadingTextColor,
        base.majorHeadingBg,
      ),
      logoColor: readable(base.accent, chromeBg, 3),
      metaThemeColor: chromeBg,
    };
    // Native chrome always uses white text; correct the surface itself if needed.
    palette.chromeBg = readable(chromeBg, "#ffffff");
    palette.metaThemeColor = palette.chromeBg;
    palettes[mode] = palette;
    await output(
      `assets/logos/${theme.id}-${mode}.svg`,
      logo
        .replaceAll("#00D0C6", palette.logoColor)
        .replaceAll("#303030", readable(base.accent, "#ffffff")),
    );
    await output(
      `assets/logos/${theme.id}-content-${mode}.svg`,
      logo
        .replaceAll("#00D0C6", readable(base.accent, "#ffffff"))
        .replaceAll("#303030", readable(base.accent, "#ffffff"))
        .replace(
          ".st1{fill:#FFFFFF;}",
          `.st1{fill:#FFFFFF;stroke:${readable(base.accent, contentBg, 3)};stroke-width:7;stroke-linejoin:round;}`,
        ),
    );
  }
  themes.push({
    ...theme,
    effect: effects[theme.id] ?? null,
    palettes,
    logos: {
      light: `logos/${theme.id}-light.svg`,
      dark: `logos/${theme.id}-dark.svg`,
    },
    contentLogos: {
      light: `logos/${theme.id}-content-light.svg`,
      dark: `logos/${theme.id}-content-dark.svg`,
    },
  });
}
// Keep short calendar tuples in the repository formatter's canonical form.
const catalog = JSON.stringify(
  { ...seed, version: 4, themes },
  null,
  2,
).replaceAll(/"window": \[\n\s+(\d+),\n\s+(\d+)\n\s+\]/g, '"window": [$1, $2]');
await output("catalog.json", catalog + "\n");
await output(
  "assets/effects.css",
  await Bun.file(new URL("src/styles.css", root)).text(),
);
process.stdout.write(
  `${check ? "Verified" : "Generated"} ${String(themes.length)} shared themes and ${String(themes.length * 4)} logos.\n`,
);
