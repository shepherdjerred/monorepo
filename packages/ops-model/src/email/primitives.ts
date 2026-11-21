export type EmailTone = "critical" | "warning" | "ok" | "info" | "neutral";

export type EmailActionLink = {
  label: string;
  url: string;
};

export type EmailDetailRow = {
  label: string;
  value: string;
  url?: string;
  mono?: boolean;
};

export type EmailItemCard = {
  tone: EmailTone;
  badge: string;
  kicker?: string;
  title: string;
  body?: string;
  nextStep?: string;
  details?: readonly EmailDetailRow[];
  links?: readonly EmailActionLink[];
};

export type EmailMetricRow = {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "good" | "bad" | "neutral";
};

export type EmailTimelineRow = {
  time: string;
  kind: string;
  title: string;
  url?: string;
};

export type EmailCheckItem = {
  status: "problem" | "skipped";
  label: string;
  summary: string;
  links?: readonly EmailActionLink[];
};

export type EmailSection =
  | {
      kind: "items";
      heading?: string;
      emptyText?: string;
      items: readonly EmailItemCard[];
      omittedNotice?: string;
    }
  | {
      kind: "metrics";
      heading: string;
      rows: readonly EmailMetricRow[];
    }
  | {
      kind: "timeline";
      heading: string;
      emptyText: string;
      rows: readonly EmailTimelineRow[];
    }
  | {
      kind: "checks";
      heading: string;
      attentionChecks: readonly EmailCheckItem[];
      passedLabels: readonly string[];
    }
  | {
      kind: "prose";
      heading: string;
      paragraphs?: readonly string[];
      bullets?: readonly string[];
    };

export type EmailCallout = {
  tone: EmailTone;
  title?: string;
  text?: string;
  bullets?: readonly string[];
};

export type EmailDocument = {
  eyebrow: string;
  tone: EmailTone;
  badge: string;
  preheader: string;
  heading: string;
  /** High-contrast plain-English summary / impact sentence right under `heading`. */
  lead?: string;
  /** Distinct single-line operator action (`Next step: ...`) rendered right below `lead`. */
  nextStep?: string;
  callout?: EmailCallout;
  /** Place primary/secondary action buttons right after the top summary (default: true). */
  actionsAboveSections?: boolean;
  sections: readonly EmailSection[];
  primaryAction?: EmailActionLink;
  secondaryActions?: readonly EmailActionLink[];
  /** Quiet 2-column aligned Technical Details rows rendered at the bottom of the card. */
  details?: readonly EmailDetailRow[];
  omittedNotice?: string;
};

const PACIFIC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

const PACIFIC_SHORT_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Los_Angeles",
});

/** Strict HTML entity escaping for untrusted text and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Accept only well-formed `http:` or `https:` URLs for email links. */
export function safeHttpUrl(
  candidate: string | undefined | null,
): string | null {
  if (candidate === undefined || candidate === null || candidate.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Format an ISO-8601 timestamp in `America/Los_Angeles` (`Nov 20, 7:45 PM PST`). */
export function formatPacificTimestamp(isoInstant: string): string {
  const epochMs = Date.parse(isoInstant);
  return Number.isNaN(epochMs)
    ? isoInstant
    : PACIFIC_DATE_TIME.format(new Date(epochMs));
}

/** Compact 24-hour Pacific timestamp for timeline tables (`Nov 20 19:45`). */
export function formatPacificShortTime(isoInstant: string): string {
  const epochMs = Date.parse(isoInstant);
  return Number.isNaN(epochMs)
    ? isoInstant
    : PACIFIC_SHORT_TIME.format(new Date(epochMs));
}
