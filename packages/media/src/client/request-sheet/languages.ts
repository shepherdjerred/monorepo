/** A subtitle language a request can name, by its BCP 47 tag. */
export type LanguageOption = { code: string; label: string };

/** The two languages this household reads subtitles in, offered first. */
export const COMMON_LANGUAGES: readonly LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "Chinese (Simplified)" },
];

/** Everything else, A to Z. */
export const MORE_LANGUAGES: readonly LanguageOption[] = [
  { code: "ar", label: "Arabic" },
  { code: "zh-Hant", label: "Chinese (Traditional)" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "nb", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
];

/** Tags older requests carry for a language this list names differently. */
const ALIASES = new Map([["zh-CN", "zh-Hans"]]);

const LABELS = new Map(
  [...COMMON_LANGUAGES, ...MORE_LANGUAGES].map((language) => [
    language.code,
    language.label,
  ]),
);

/**
 * A language's name for a tag a request or a subtitle file carries. A tag
 * outside the list is named by the browser; one the browser cannot name is
 * shown as it is, which is still what the file says.
 */
export function languageName(code: string): string {
  const known = LABELS.get(ALIASES.get(code) ?? code);
  if (known !== undefined) return known;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
