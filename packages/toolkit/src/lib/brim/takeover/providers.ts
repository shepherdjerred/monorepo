import { z } from "zod";
import type { HistorySourceName } from "#lib/history/types.ts";
import { TakeoverError } from "./errors.ts";

export const BRIM_PROVIDER_IDS = [
  "claude-code",
  "codex",
  "antigravity",
  "cursor",
  "grok",
  "kimi",
  "muse",
] as const;

export const BrimProviderIdSchema = z.enum(BRIM_PROVIDER_IDS);

export type BrimProviderId = z.infer<typeof BrimProviderIdSchema>;

export const BRIM_HISTORY_SOURCES = [
  "claude",
  "codex",
  "antigravity",
  "cursor",
  "grok",
  "kimi",
  "muse",
] as const satisfies readonly HistorySourceName[];

export const BrimHistorySourceSchema = z.enum(BRIM_HISTORY_SOURCES);

export type BrimHistorySourceName = z.infer<typeof BrimHistorySourceSchema>;

export type ProviderDescriptor = {
  readonly provider: BrimProviderId;
  readonly historySource: BrimHistorySourceName;
  readonly displayName: string;
};

const PROVIDER_DESCRIPTORS: Readonly<
  Record<BrimProviderId, ProviderDescriptor>
> = {
  "claude-code": {
    provider: "claude-code",
    historySource: "claude",
    displayName: "Claude Code",
  },
  codex: {
    provider: "codex",
    historySource: "codex",
    displayName: "Codex",
  },
  antigravity: {
    provider: "antigravity",
    historySource: "antigravity",
    displayName: "Antigravity",
  },
  cursor: {
    provider: "cursor",
    historySource: "cursor",
    displayName: "Cursor",
  },
  grok: {
    provider: "grok",
    historySource: "grok",
    displayName: "Grok",
  },
  kimi: {
    provider: "kimi",
    historySource: "kimi",
    displayName: "Kimi",
  },
  muse: {
    provider: "muse",
    historySource: "muse",
    displayName: "Muse",
  },
};

const HISTORY_SOURCE_TO_PROVIDER: Readonly<
  Partial<Record<HistorySourceName, BrimProviderId>>
> = {
  claude: "claude-code",
  "claude-mirror": "claude-code",
  codex: "codex",
  "codex-mirror": "codex",
  antigravity: "antigravity",
  "antigravity-mirror": "antigravity",
  cursor: "cursor",
  grok: "grok",
  "grok-mirror": "grok",
  kimi: "kimi",
  "kimi-mirror": "kimi",
  muse: "muse",
  "muse-mirror": "muse",
};

const PROVIDER_ALIASES: Readonly<Record<string, BrimProviderId>> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  "claude code": "claude-code",
  "claude-mirror": "claude-code",
  codex: "codex",
  "codex-mirror": "codex",
  agy: "antigravity",
  gemini: "antigravity",
  antigravity: "antigravity",
  "google antigravity": "antigravity",
  "antigravity-cli": "antigravity",
  "antigravity-ide": "antigravity",
  "antigravity-mirror": "antigravity",
  cursor: "cursor",
  "cursor-agent": "cursor",
  agent: "cursor",
  grok: "grok",
  "grok-build": "grok",
  "grok-mirror": "grok",
  kimi: "kimi",
  "kimi-code": "kimi",
  "kimi code": "kimi",
  "kimi-mirror": "kimi",
  muse: "muse",
  "meta muse": "muse",
  "meta-muse": "muse",
  "muse-mirror": "muse",
};

export function providerDescriptor(
  provider: BrimProviderId,
): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[provider];
}

export function historySourceForProvider(
  provider: BrimProviderId,
): BrimHistorySourceName {
  return PROVIDER_DESCRIPTORS[provider].historySource;
}

export function takeoverDisplayName(provider: BrimProviderId): string {
  return PROVIDER_DESCRIPTORS[provider].displayName;
}

/**
 * Maps a `toolkit history` source (including `*-mirror` sources) to its Brim
 * provider ID, or `null` for non-Brim sources (`conductor`).
 */
export function providerForHistorySource(
  source: HistorySourceName,
): BrimProviderId | null {
  return HISTORY_SOURCE_TO_PROVIDER[source] ?? null;
}

/**
 * Narrows a `HistorySourceName` to one of the 7 local Brim agent sources,
 * returning `null` for `conductor` and `*-mirror` sources.
 */
export function localBrimHistorySource(
  source: HistorySourceName,
): BrimHistorySourceName | null {
  const parsed = BrimHistorySourceSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolves a Brim provider ID, history source name, wrapper binary name, Herdr
 * `status.app` identifier, or display name to a canonical `BrimProviderId`.
 */
export function resolveBrimProvider(input: string): BrimProviderId | null {
  const normalized = input.trim().toLowerCase();
  return normalized.length === 0
    ? null
    : (PROVIDER_ALIASES[normalized] ?? null);
}

export function requireBrimProvider(
  input: string,
  context?: string,
): BrimProviderId {
  const resolved = resolveBrimProvider(input);
  if (resolved === null) {
    const label = context === undefined ? "provider" : `${context} provider`;
    throw new TakeoverError(
      `Unknown ${label} "${input}". Known providers: ${BRIM_PROVIDER_IDS.join(", ")}.`,
    );
  }
  return resolved;
}
