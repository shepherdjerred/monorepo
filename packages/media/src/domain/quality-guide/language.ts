// ISO 639-2 bibliographic aliases are not all canonicalized by Intl.Locale.
const BIBLIOGRAPHIC: Readonly<Record<string, string>> = {
  alb: "sq",
  arm: "hy",
  baq: "eu",
  bur: "my",
  chi: "zh",
  cze: "cs",
  dut: "nl",
  fre: "fr",
  geo: "ka",
  ger: "de",
  gre: "el",
  ice: "is",
  mac: "mk",
  mao: "mi",
  may: "ms",
  per: "fa",
  rum: "ro",
  slo: "sk",
  tib: "bo",
  wel: "cy",
};

/** Compare catalog ISO 639-1, ffprobe ISO 639-2, and regional track tags
 * without treating an unspecified or multiple-language track as proof. */
export function canonicalLanguage(value: string): string | null {
  const tag = value.trim().replaceAll("_", "-").toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(tag)) return null;
  try {
    const language = new Intl.Locale(tag).language;
    return ["und", "mul", "zxx"].includes(language)
      ? null
      : (BIBLIOGRAPHIC[language] ?? language);
  } catch {
    return null;
  }
}

export function originalAudioPresence(
  original: string | null,
  audio: readonly string[] | null,
): "present" | "missing" | "unknown" {
  const language = original === null ? null : canonicalLanguage(original);
  const tracks =
    audio?.flatMap((value) => {
      const normalized = canonicalLanguage(value);
      return normalized === null ? [] : [normalized];
    }) ?? [];
  if (language === null || tracks.length === 0) return "unknown";
  return tracks.includes(language) ? "present" : "missing";
}

export function originalLanguageForMedia(media: {
  originalLanguage: string | null;
  parent?: {
    originalLanguage: string | null;
    parent?: { originalLanguage: string | null } | null;
  } | null;
}): string | null {
  const language =
    media.originalLanguage ??
    media.parent?.originalLanguage ??
    media.parent?.parent?.originalLanguage ??
    null;
  return language === null ? null : canonicalLanguage(language);
}
