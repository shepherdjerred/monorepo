export type SeasonRefreshPromptInput = {
  today: string;
  workdir: string;
  seasonsFile: string;
  seasonsTestFile: string;
  noDriftSentinel: string;
  driftedSentinel: string;
};

export function buildSeasonRefreshPrompt(
  input: SeasonRefreshPromptInput,
): string {
  return [
    "You are refreshing Scout for LoL's hard-coded League of Legends season schedule.",
    "",
    `Today is ${input.today}. The repo is checked out at ${input.workdir}.`,
    "",
    "## Source of truth",
    "",
    `- ${input.seasonsFile} — the SEASONS record and SeasonIdSchema Zod enum.`,
    `- ${input.seasonsTestFile} — keep the valid-IDs list in sync.`,
    "",
    "## Task",
    "",
    "1. Read seasons.ts to understand the current schedule.",
    "2. Research the current and upcoming LoL season/act dates from at least",
    "   TWO independent sources (cross-check before editing):",
    "   - https://wiki.leagueoflegends.com/en-us/  (annual cycle + per-season pages)",
    "   - https://www.leagueoflegends.com/en-us/news/  (announcements)",
    "   - https://support-leagueoflegends.riotgames.com/  (patch schedule)",
    "3. If seasons.ts is already accurate, exit WITHOUT editing any file. The",
    `   last line of your final response MUST be exactly: ${input.noDriftSentinel}`,
    "4. If dates are wrong, or new acts/seasons have been announced, edit",
    "   seasons.ts (both the SeasonIdSchema enum and the SEASONS record):",
    "   - Keep existing season IDs UNTOUCHED. Persisted competitions reference",
    "     them — only ADD new IDs or ADJUST existing dates. Never rename or",
    "     delete an existing ID.",
    "   - Maintain the 1-day-gap convention between consecutive acts (e.g.,",
    "     act N ends YYYY-MM-DDT23:59:59 and act N+1 starts YYYY-MM-(DD+1)T00:00:00).",
    "   - Use PST/PDT timezone offsets to match the existing style (-07:00 in",
    "     daylight time, -08:00 in standard time).",
    "   - Display names follow the convention 'Season Name (Act N)'.",
    `   - Also extend the valid-IDs list in ${input.seasonsTestFile}.`,
    "5. Verify your edit by running:",
    `      cd ${input.workdir}/packages/scout-for-lol/packages/data`,
    "      bun test src/seasons.test.ts",
    "   If tests fail, fix them. Do NOT skip tests, do NOT weaken assertions.",
    "6. Your final response MUST end with one of these sentinel lines exactly:",
    `   - ${input.noDriftSentinel}   (file was already accurate, no edits)`,
    `   - ${input.driftedSentinel}   (file was edited)`,
    `   Before the sentinel, when ${input.driftedSentinel}, list each change`,
    "   and the URL you sourced it from in bullet form.",
    "",
    "## Rules",
    "",
    "- Never invent season dates. If you cannot find a confirmed date from a",
    "  primary source (Riot, LoL wiki), do NOT add the season. Print",
    `  ${input.noDriftSentinel} and leave it for next week's run.`,
    "- Never modify any file outside seasons.ts and seasons.test.ts.",
    "- Never run git commands — the calling activity handles git state.",
    "- Never push to origin or open PRs — same reason.",
  ].join("\n");
}
