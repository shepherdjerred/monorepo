import { runCommand } from "./scout-season-refresh-git.ts";

const NO_DRIFT_SENTINEL = "NO_DRIFT";
const DRIFTED_SENTINEL = "DRIFTED";

export type SeasonEvidenceAssessment = {
  sourceUrls: string[];
  sourceEvidenceComplete: boolean;
  sentinelAgreement: boolean;
  validationPassed: boolean;
  reason: string | undefined;
};

function seasonSourceFamily(url: string): "riot" | "wiki" | undefined {
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
          const host = new URL(url).hostname;
          return [
            "wiki.leagueoflegends.com",
            "www.leagueoflegends.com",
            "leagueoflegends.com",
            "support-leagueoflegends.riotgames.com",
          ].includes(host);
        }),
    ),
  ];
}

export async function assessSeasonEvidence(input: {
  resultText: string;
  filesChanged: number;
  repoDir: string;
}): Promise<SeasonEvidenceAssessment> {
  const noDrift = input.resultText.includes(NO_DRIFT_SENTINEL);
  const drifted = input.resultText.includes(DRIFTED_SENTINEL);
  const sentinelAgreement =
    (input.filesChanged === 0 && noDrift && !drifted) ||
    (input.filesChanged > 0 && drifted && !noDrift);
  const fetched: string[] = [];
  for (const url of seasonSourceUrls(input.resultText)) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "temporal-scout-season-refresh/1" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) fetched.push(url);
    } catch {
      // Failed sources stay absent so the report cannot claim clean coverage.
    }
  }
  await runCommand(["bun", "test", "src/seasons.test.ts"], {
    cwd: `${input.repoDir}/packages/scout-for-lol/packages/data`,
  });
  const sourceEvidenceComplete = hasIndependentSeasonSources(fetched);
  return {
    sourceUrls: fetched,
    sourceEvidenceComplete,
    sentinelAgreement,
    validationPassed: true,
    reason: sentinelAgreement
      ? sourceEvidenceComplete
        ? undefined
        : "independent Riot and wiki season sources were not both fetched successfully"
      : "source sentinel and deterministic diff disagree",
  };
}
