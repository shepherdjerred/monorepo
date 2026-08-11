import { runCommand } from "./scout-season-refresh-git.ts";

const NO_DRIFT_SENTINEL = "NO_DRIFT";
const DRIFTED_SENTINEL = "DRIFTED";

export type SeasonEvidenceAssessment = {
  sourceUrls: string[];
  requiredDates: string[];
  unsupportedDates: string[];
  sourceEvidenceComplete: boolean;
  sentinelAgreement: boolean;
  validationPassed: boolean;
  reason: string | undefined;
};

type SeasonSourceDocument = {
  url: string;
  content: string;
};

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MAX_SOURCE_CONTENT_LENGTH = 4_000_000;
const SEASON_CONTEXT_PATTERN = /\b(?:act|patch|ranked|season)\b/u;

function seasonSourceFamily(url: string): "riot" | "wiki" | undefined {
  if (!URL.canParse(url)) return undefined;
  const host = new URL(url).hostname;
  if (host === "wiki.leagueoflegends.com") {
    return "wiki";
  }
  if (
    [
      "www.leagueoflegends.com",
      "leagueoflegends.com",
      "support-leagueoflegends.riotgames.com",
    ].includes(host)
  ) {
    return "riot";
  }
  return undefined;
}

function isSpecificSeasonSource(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter((part) => part !== "");
  const family = seasonSourceFamily(url);
  if (family === "wiki") return segments.length >= 2;
  if (parsed.hostname === "support-leagueoflegends.riotgames.com")
    return segments.includes("articles") && segments.length >= 4;
  return family === "riot" && segments.length >= 4;
}

export function hasIndependentSeasonSources(urls: string[]): boolean {
  const families = urls
    .map((url) => seasonSourceFamily(url))
    .filter((family) => family !== undefined);
  return new Set(families).size >= 2;
}

function seasonSourceUrls(text: string): string[] {
  const matches = text.matchAll(/https:\/\/[^\s)>]+/g);
  return [
    ...new Set(
      [...matches]
        .map((match) => match[0].replaceAll(/[.,;]+$/g, ""))
        .filter((url) => {
          return isSpecificSeasonSource(url);
        }),
    ),
  ];
}

function datesInText(text: string): string[] {
  const matches = text.match(/\d{4}-\d{2}-\d{2}/g);
  return matches === null ? [] : [...new Set(matches)].toSorted();
}

export function seasonDateClaimsFromDiff(
  diff: string,
  seasonsFile: string,
): string[] {
  const dates: string[] = [];
  let inSeasonsFile = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inSeasonsFile = line.startsWith(
        `diff --git a/${seasonsFile} b/${seasonsFile}`,
      );
      continue;
    }
    if (inSeasonsFile && line.startsWith("+") && !line.startsWith("+++")) {
      dates.push(...datesInText(line));
    }
  }
  return [...new Set(dates)].toSorted();
}

export function currentSeasonDateClaims(
  seasonsSource: string,
  now: Date,
): string[] {
  const dates: string[] = [];
  const seasonDates = seasonsSource.matchAll(
    /startDate:\s*new Date\("(\d{4}-\d{2}-\d{2})[^"]*"\),\s*endDate:\s*new Date\("(\d{4}-\d{2}-\d{2})[^"]*"\)/gu,
  );
  for (const match of seasonDates) {
    const startDate = match[1];
    const endDate = match[2];
    if (startDate === undefined || endDate === undefined) continue;
    if (Date.parse(`${endDate}T23:59:59.999Z`) >= now.getTime()) {
      dates.push(startDate, endDate);
    }
  }
  return [...new Set(dates)].toSorted();
}

function normalizedSourceContent(content: string): string {
  return content
    .toLowerCase()
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*([,/-])\s*/g, "$1");
}

function sourceContainsDate(content: string, date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) return false;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (year === undefined || month === undefined || day === undefined)
    return false;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName === undefined) return false;
  const shortMonth = monthName.slice(0, 3);
  const numericMonth = String(Number(month));
  const numericDay = String(Number(day));
  const normalized = normalizedSourceContent(content);
  const variants = [
    date,
    `${year}/${month}/${day}`,
    `${month}/${day}/${year}`,
    `${numericMonth}/${numericDay}/${year}`,
    `${day}/${month}/${year}`,
    `${numericDay}/${numericMonth}/${year}`,
    `${monthName} ${numericDay},${year}`,
    `${monthName} ${numericDay} ${year}`,
    `${shortMonth} ${numericDay},${year}`,
    `${shortMonth} ${numericDay} ${year}`,
    `${numericDay} ${monthName} ${year}`,
    `${numericDay} ${shortMonth} ${year}`,
  ];
  return variants.some((variant) => {
    let index = normalized.indexOf(variant);
    while (index >= 0) {
      const context = normalized.slice(
        Math.max(0, index - 200),
        index + variant.length + 200,
      );
      if (SEASON_CONTEXT_PATTERN.test(context)) return true;
      index = normalized.indexOf(variant, index + variant.length);
    }
    return false;
  });
}

export function unsupportedSeasonDates(
  sources: SeasonSourceDocument[],
  requiredDates: string[],
): string[] {
  return requiredDates.filter((date) => {
    const supportingFamilies = new Set(
      sources
        .filter(
          (source) =>
            isSpecificSeasonSource(source.url) &&
            sourceContainsDate(source.content, date),
        )
        .map((source) => seasonSourceFamily(source.url))
        .filter((family) => family !== undefined),
    );
    return supportingFamilies.size < 2;
  });
}

export async function assessSeasonEvidence(input: {
  resultText: string;
  filesChanged: number;
  repoDir: string;
  diff: string;
  seasonsFile: string;
}): Promise<SeasonEvidenceAssessment> {
  const noDrift = input.resultText.includes(NO_DRIFT_SENTINEL);
  const drifted = input.resultText.includes(DRIFTED_SENTINEL);
  const sentinelAgreement =
    (input.filesChanged === 0 && noDrift && !drifted) ||
    (input.filesChanged > 0 && drifted && !noDrift);
  const fetched: SeasonSourceDocument[] = [];
  for (const url of seasonSourceUrls(input.resultText)) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "temporal-scout-season-refresh/1" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const content = await response.text();
        fetched.push({
          url,
          content: content.slice(0, MAX_SOURCE_CONTENT_LENGTH),
        });
      }
    } catch {
      // Failed sources stay absent so the report cannot claim clean coverage.
    }
  }
  await runCommand(["bun", "test", "src/seasons.test.ts"], {
    cwd: `${input.repoDir}/packages/scout-for-lol/packages/data`,
  });
  const requiredDates =
    input.filesChanged > 0
      ? seasonDateClaimsFromDiff(input.diff, input.seasonsFile)
      : currentSeasonDateClaims(
          await Bun.file(`${input.repoDir}/${input.seasonsFile}`).text(),
          new Date(),
        );
  const unsupportedDates = unsupportedSeasonDates(fetched, requiredDates);
  const sourceEvidenceComplete =
    requiredDates.length > 0 && unsupportedDates.length === 0;
  return {
    sourceUrls: fetched.map((source) => source.url),
    requiredDates,
    unsupportedDates,
    sourceEvidenceComplete,
    sentinelAgreement,
    validationPassed: true,
    reason: sentinelAgreement
      ? sourceEvidenceComplete
        ? undefined
        : requiredDates.length === 0
          ? "no current, upcoming, or changed season date claims were available for validation"
          : `season dates were not corroborated by both Riot and wiki content: ${unsupportedDates.join(", ")}`
      : "source sentinel and deterministic diff disagree",
  };
}
