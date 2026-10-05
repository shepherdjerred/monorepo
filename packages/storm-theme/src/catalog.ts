import { z } from "zod";
import catalog from "#data/catalog.json";

const ColorSchema = z.string().regex(/^#[a-f0-9]{6}$/i);
const PaletteSchema = z
  .object({
    chromeBg: ColorSchema,
    subNavBg: ColorSchema,
    accent: ColorSchema,
    linkColor: ColorSchema,
    linkHoverColor: ColorSchema,
    majorHeadingBg: ColorSchema,
    majorHeadingTextColor: ColorSchema,
    subNavTextColor: ColorSchema,
    chromeTextColor: ColorSchema,
    chromeHoverColor: ColorSchema,
    subNavHoverColor: ColorSchema,
    contentBg: ColorSchema,
    pageBg: ColorSchema,
    minorHeadingTextColor: ColorSchema,
    contentAltBg: ColorSchema,
    contentHighlightBg: ColorSchema,
    textColor: ColorSchema,
    textColorMuted: ColorSchema,
    textColorDimmed: ColorSchema,
    textColorEmphasized: ColorSchema,
    textColorFeature: ColorSchema,
    borderColor: ColorSchema,
    borderColorLight: ColorSchema,
    borderColorHeavy: ColorSchema,
    inputBgColor: ColorSchema,
    inputTextColor: ColorSchema,
    inputBorderColor: ColorSchema,
    controlColor: ColorSchema,
    focusColor: ColorSchema,
    buttonPrimaryBg: ColorSchema,
    buttonPrimaryColor: ColorSchema,
    buttonPrimaryHoverBg: ColorSchema,
    buttonCtaBg: ColorSchema,
    buttonCtaColor: ColorSchema,
    selectedItemBgColor: ColorSchema,
    selectedItemColor: ColorSchema,
    paletteColor1: ColorSchema,
    paletteColor2: ColorSchema,
    paletteColor3: ColorSchema,
    paletteColor4: ColorSchema,
    paletteColor5: ColorSchema,
    logoColor: ColorSchema,
    metaThemeColor: ColorSchema,
  })
  .strict();
const AssetSchema = z.string().regex(/^[a-z/-]+\.(jpg|svg)$/);
function validDay(day: number) {
  const month = Math.floor(day / 100),
    date = day % 100;
  const actual = new Date(Date.UTC(2024, month - 1, date));
  return actual.getUTCMonth() === month - 1 && actual.getUTCDate() === date;
}
function validateWindow(
  window: [number, number],
  days: Set<number>,
  ctx: z.RefinementCtx,
) {
  const [start, end] = window;
  if (start > end || !validDay(start) || !validDay(end)) {
    ctx.addIssue({ code: "custom", message: "Invalid festival window" });
    return;
  }
  for (let day = start; day <= end; day++) {
    if (days.has(day))
      ctx.addIssue({ code: "custom", message: "Overlapping festival windows" });
    days.add(day);
  }
}
export const ThemeCatalogSchema = z
  .object({
    version: z.literal(3),
    timeZone: z.literal("America/Los_Angeles"),
    scenery: z.record(
      z.string(),
      z.object({ desktop: AssetSchema, mobile: AssetSchema }).strict(),
    ),
    themes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z]+$/),
            name: z.string().min(1),
            scenery: z.string(),
            decoration: AssetSchema.nullable(),
            effect: z
              .enum([
                "confetti",
                "hearts",
                "petals",
                "sparks",
                "leaves",
                "snow",
              ])
              .nullable(),
            logos: z.object({ light: AssetSchema, dark: AssetSchema }).strict(),
            window: z.tuple([z.number().int(), z.number().int()]).nullable(),
            palettes: z
              .object({ light: PaletteSchema, dark: PaletteSchema })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const days = new Set<number>();
    for (const theme of value.themes) {
      if (
        ids.has(theme.id) ||
        theme.id === "auto" ||
        value.scenery[theme.scenery] === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate theme or missing scenery",
        });
      }
      ids.add(theme.id);
      if (theme.effect !== null && theme.window === null) {
        ctx.addIssue({
          code: "custom",
          message: "Falling effects require a festival window",
        });
      }
      if (theme.window !== null) {
        validateWindow(theme.window, days, ctx);
      }
    }
    for (const id of ["normal", "spring", "summer", "autumn", "winter"]) {
      if (!ids.has(id))
        ctx.addIssue({ code: "custom", message: `Missing base season: ${id}` });
    }
  });
export const themeCatalog = ThemeCatalogSchema.parse(catalog);
export const ThemeIdSchema = z
  .string()
  .refine(
    (id) => themeCatalog.themes.some((theme) => theme.id === id),
    "Unknown Storm theme",
  );
export const SeasonChoiceSchema = z.union([z.literal("auto"), ThemeIdSchema]);

const pacificDate = new Intl.DateTimeFormat("en-US", {
  timeZone: themeCatalog.timeZone,
  month: "numeric",
  day: "numeric",
});
export function resolveTheme(
  choice: string,
  calendarEnabled: boolean,
  now: Date,
): string {
  SeasonChoiceSchema.parse(choice);
  if (choice !== "auto" || !calendarEnabled)
    return choice === "auto" ? "normal" : choice;
  const parts = pacificDate.formatToParts(now);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const date = month * 100 + day;
  const festival = themeCatalog.themes.find(
    (theme) =>
      theme.window !== null &&
      date >= theme.window[0] &&
      date <= theme.window[1],
  );
  if (festival !== undefined) return festival.id;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  return month >= 9 && month <= 11 ? "autumn" : "winter";
}
