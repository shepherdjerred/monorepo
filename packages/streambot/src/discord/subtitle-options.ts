import type { SubtitlePref } from "@shepherdjerred/streambot/sources/source.ts";

/**
 * Build a per-request subtitle preference from an on/off string and a language string. Returns
 * undefined when neither is set, so the source falls back to the server's subtitle config. Shared
 * by `/stream play`'s `subtitles`/`sublang` options and `/stream subtitles`'s `mode`/`language`.
 */
export function buildSubtitlePref(
  subtitles: string | null,
  sublang: string | null,
): SubtitlePref | undefined {
  const enabled = subtitles === null ? undefined : subtitles === "on";
  const trimmed = sublang?.trim() ?? "";
  const language = trimmed.length > 0 ? trimmed : undefined;
  if (enabled === undefined && language === undefined) return undefined;
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(language === undefined ? {} : { language }),
  };
}

/** A short " _(subtitles: …)_" suffix for the ephemeral ack, or "" when no override was given. */
export function subtitlesSuffix(pref: SubtitlePref | undefined): string {
  if (pref?.enabled === false) return " _(subtitles: off)_";
  if (pref?.enabled === true) {
    return pref.language === undefined
      ? " _(subtitles: on)_"
      : ` _(subtitles: ${pref.language})_`;
  }
  if (pref?.language !== undefined) return ` _(subtitles: ${pref.language})_`;
  return "";
}
