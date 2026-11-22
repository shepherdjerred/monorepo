import type { ShortcutSpec } from "#shared/contract.ts";

export type ShortcutMatch = {
  readonly kind: "shortcut";
  readonly matchedShort: string;
  readonly location: string;
};

const POSITIVE_DIGITS_REGEX = /^[1-9]\d*$/u;
const COMMIT_SHA_REGEX = /^[0-9a-f]{7,40}$/iu;
const PREFIXED_ISSUE_REGEX = /^(ai|sj|fm)-([1-9]\d*)$/iu;
const TRACKER_TEAMS = new Set(["ai", "sj", "fm"]);

export const FIXED_SHORTCUT_BASES: Readonly<
  Record<string, { readonly targetUrl: string; readonly detail: string }>
> = {
  gh: {
    targetUrl: "https://github.com/shepherdjerred/",
    detail: "GitHub profile shortcut",
  },
  mono: {
    targetUrl: "https://github.com/shepherdjerred/monorepo",
    detail: "Monorepo repository shortcut",
  },
  pr: {
    targetUrl: "https://github.com/shepherdjerred/monorepo/pulls",
    detail: "Monorepo pull requests shortcut",
  },
};

export function builtinShortcuts(tailnetDomain: string): ShortcutSpec[] {
  const trackerHost = `https://tracker.${tailnetDomain}`;
  return [
    {
      pattern: "gh[/<repo-or-path>]",
      exampleShort: "gh/monorepo",
      exampleTargetUrl: "https://github.com/shepherdjerred/monorepo",
      description: "GitHub profile or repository path under shepherdjerred.",
    },
    {
      pattern: "mono[/<path>]",
      exampleShort: "mono/pulls",
      exampleTargetUrl: "https://github.com/shepherdjerred/monorepo/pulls",
      description: "Monorepo root or repository path.",
    },
    {
      pattern: "pr[/<number>]",
      exampleShort: "pr/4782",
      exampleTargetUrl: "https://github.com/shepherdjerred/monorepo/pull/4782",
      description: "Monorepo pull requests list or specific PR by number.",
    },
    {
      pattern: "commit/<sha>",
      exampleShort: "commit/a1b2c3d",
      exampleTargetUrl:
        "https://github.com/shepherdjerred/monorepo/commit/a1b2c3d",
      description: "Monorepo commit by 7–40 character hexadecimal SHA.",
    },
    {
      pattern: "ai/<num> | ai-<num>",
      exampleShort: "ai/128",
      exampleTargetUrl: `${trackerHost}/issues/AI-128`,
      description: "Tracker AI team issue.",
    },
    {
      pattern: "sj/<num> | sj-<num>",
      exampleShort: "sj/42",
      exampleTargetUrl: `${trackerHost}/issues/SJ-42`,
      description: "Tracker SJ team issue.",
    },
    {
      pattern: "fm/<num> | fm-<num>",
      exampleShort: "fm/19",
      exampleTargetUrl: `${trackerHost}/forum/FM-19`,
      description: "Tracker forum thread.",
    },
  ];
}

export function parseSafeHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function forwardSubpathAndQuery(
  baseTargetUrl: string,
  rawSubpath: string,
  rawSearch: string,
): string | null {
  const parsed = parseSafeHttpUrl(baseTargetUrl);
  if (parsed === null) {
    return null;
  }
  const cleanSubpath = rawSubpath.replace(/^\/+/u, "");
  const cleanSearch = rawSearch.startsWith("?")
    ? rawSearch.slice(1)
    : rawSearch;

  if (cleanSubpath.length === 0 && cleanSearch.length === 0) {
    return parsed.toString();
  }

  if (cleanSubpath.length > 0) {
    const basePathname = parsed.pathname.replace(/\/+$/u, "");
    parsed.pathname = `${basePathname}/${cleanSubpath}`;
  }

  if (cleanSearch.length > 0) {
    const incomingParams = new URLSearchParams(cleanSearch);
    for (const [key, value] of incomingParams.entries()) {
      parsed.searchParams.append(key, value);
    }
  }

  return parsed.toString();
}

function makeShortcutRedirect(
  matchedShort: string,
  baseTarget: string,
  search: string,
): ShortcutMatch | null {
  const location = forwardSubpathAndQuery(baseTarget, "", search);
  return location === null
    ? null
    : { kind: "shortcut", matchedShort, location };
}

function trackerTargetForTeam(
  teamPrefix: string,
  issueNumber: string,
  tailnetDomain: string,
): string {
  const upperTeam = teamPrefix.toUpperCase();
  const base = `https://tracker.${tailnetDomain}`;
  return upperTeam === "FM"
    ? `${base}/forum/FM-${issueNumber}`
    : `${base}/issues/${upperTeam}-${issueNumber}`;
}

function resolveGithubShortcut(
  short: string,
  cleanSubpath: string,
  search: string,
): ShortcutMatch | null {
  if (short === "gh") {
    const base =
      cleanSubpath.length === 0
        ? "https://github.com/shepherdjerred/"
        : `https://github.com/shepherdjerred/${cleanSubpath}`;
    return makeShortcutRedirect("gh", base, search);
  }
  if (short === "mono") {
    const base =
      cleanSubpath.length === 0
        ? "https://github.com/shepherdjerred/monorepo"
        : `https://github.com/shepherdjerred/monorepo/${cleanSubpath}`;
    return makeShortcutRedirect("mono", base, search);
  }
  if (short === "pr") {
    if (cleanSubpath.length === 0) {
      return makeShortcutRedirect(
        "pr",
        "https://github.com/shepherdjerred/monorepo/pulls",
        search,
      );
    }
    return POSITIVE_DIGITS_REGEX.test(cleanSubpath)
      ? makeShortcutRedirect(
          "pr",
          `https://github.com/shepherdjerred/monorepo/pull/${cleanSubpath}`,
          search,
        )
      : null;
  }
  return short === "commit" && COMMIT_SHA_REGEX.test(cleanSubpath)
    ? makeShortcutRedirect(
        "commit",
        `https://github.com/shepherdjerred/monorepo/commit/${cleanSubpath.toLowerCase()}`,
        search,
      )
    : null;
}

function resolveTrackerShortcut(
  short: string,
  cleanSubpath: string,
  search: string,
  tailnetDomain: string,
): ShortcutMatch | null {
  if (TRACKER_TEAMS.has(short) && POSITIVE_DIGITS_REGEX.test(cleanSubpath)) {
    return makeShortcutRedirect(
      short,
      trackerTargetForTeam(short, cleanSubpath, tailnetDomain),
      search,
    );
  }
  if (cleanSubpath.length > 0) {
    return null;
  }
  const hyphenMatch = PREFIXED_ISSUE_REGEX.exec(short);
  const team = hyphenMatch?.[1];
  const num = hyphenMatch?.[2];
  return team === undefined || num === undefined
    ? null
    : makeShortcutRedirect(
        short,
        trackerTargetForTeam(team, num, tailnetDomain),
        search,
      );
}

export function resolveShortcut(
  short: string,
  cleanSubpath: string,
  search: string,
  tailnetDomain: string,
): ShortcutMatch | null {
  return (
    resolveGithubShortcut(short, cleanSubpath, search) ??
    resolveTrackerShortcut(short, cleanSubpath, search, tailnetDomain)
  );
}
