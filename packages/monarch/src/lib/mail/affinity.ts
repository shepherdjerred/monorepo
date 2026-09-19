import type { EmailIndexEntry } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

// Scoring a (transaction, email) pair for merchant affinity.
//
// Exact token-set membership is not enough: a merchant's brand is spaced in
// the statement but concatenated in the domain ("Best Buy" vs bestbuy.com),
// or the domain carries a suffix ("Steam" vs steampowered.com). Those pairs
// used to score 0 and were discarded before the model ever saw them, which is
// why whole merchants stayed unenriched. Matching is therefore containment
// aware, with length guards so short tokens cannot manufacture noise.

// Generic tokens that appear in most merchants/senders and carry no signal.
const STOP_TOKENS = new Set([
  "the",
  "inc",
  "llc",
  "com",
  "net",
  "org",
  "co",
  "corp",
  "ltd",
  "shop",
  "store",
  "online",
  "www",
  "email",
  "mail",
  "no",
  "reply",
  "noreply",
  "notifications",
  "notification",
  "receipts",
  "receipt",
  "order",
  "orders",
  "support",
  "hello",
  "info",
  "team",
  "us",
  "and",
  "of",
]);

// Domain labels that identify the sending infrastructure rather than the
// brand. Dropping them keeps "email.ticketmaster.com" pointing at
// "ticketmaster" instead of matching every ESP-hosted sender.
const DOMAIN_STOP_LABELS = new Set([
  "com",
  "net",
  "org",
  "io",
  "co",
  "us",
  "uk",
  "ca",
  "de",
  "ai",
  "app",
  "dev",
  "info",
  "biz",
  "shop",
  "store",
  "email",
  "mail",
  "mailer",
  "news",
  "notify",
  "notifications",
  "noreply",
  "reply",
  "order",
  "orders",
  "post",
  "send",
  "sendgrid",
  "sparkpostmail",
  "mailgun",
  "mkt",
  "marketing",
  "updates",
  "alerts",
  "click",
  "links",
  "members",
  "supportmessaging",
  "support",
  "engage",
  "messages",
  "survey",
  "policy",
  "otp",
  "forbusiness",
]);

// Merchant compact form -> domain label(s) that mean the same brand.
const MERCHANT_ALIASES: Record<string, readonly string[]> = {
  ubereats: ["uber"],
  // Amazon owns Whole Foods, but an amazon.com order email never documents a
  // grocery charge: measured over 22 judged Whole Foods transactions, the
  // alias shortlisted Amazon orders every time and matched none of them. The
  // store does not email receipts, so paying to be told that is waste.
  wholefoods: ["wholefoods"],
  wholefoodsmarket: ["wholefoods"],
  amznmktpus: ["amazon"],
  amzn: ["amazon"],
  chatgpt: ["openai"],
  amc: ["amctheatres"],
  thehomedepot: ["homedepot"],
};

const MIN_AFFIX_LENGTH = 5;
const MIN_INTERIOR_LENGTH = 8;
const MIN_TOKEN_AFFIX_LENGTH = 4;
const MAX_TOKEN_OVERLAP_SCORE = 3;

export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOP_TOKENS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

// "America's Test Kitchen" -> "americastestkitchen"; strips card-processor
// prefixes and trailing store numbers that never appear in a sender domain.
export function compactMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(?:sq|tst|sp|pay|pp|cke)\s*\*\s*/, "")
    .replace(/\s+#?\d{2,}$/, "")
    .replaceAll(/[^a-z0-9]/g, "");
}

// Brand-ish labels from a From header. A set, not a single "core": real
// senders include brand TLDs (post.applecard.apple) and hyphenated labels
// (c-openai.com), so both need to survive.
export function senderDomainLabels(fromHeader: string): Set<string> {
  const match = /@([a-z0-9.-]+)/.exec(fromHeader.toLowerCase());
  const labels = new Set<string>();
  const domain = match?.[1];
  if (domain === undefined || domain === "") return labels;
  for (const label of domain.split(".")) {
    for (const part of [label, ...label.split("-")]) {
      if (part.length < 3) continue;
      if (DOMAIN_STOP_LABELS.has(part)) continue;
      labels.add(part);
    }
  }
  return labels;
}

// Highest-confidence relationship between the merchant and any domain label.
// Max-of rather than summed: one brand match is one piece of evidence.
function domainScore(merchantCompact: string, labels: Set<string>): number {
  if (merchantCompact.length < 3 || labels.size === 0) return 0;
  const aliases = MERCHANT_ALIASES[merchantCompact] ?? [];
  let best = 0;
  for (const label of labels) {
    if (label === merchantCompact || aliases.includes(label)) return 4;
    const shorter =
      label.length < merchantCompact.length ? label : merchantCompact;
    const longer =
      label.length < merchantCompact.length ? merchantCompact : label;
    if (
      shorter.length >= MIN_AFFIX_LENGTH &&
      (longer.startsWith(shorter) || longer.endsWith(shorter))
    ) {
      best = Math.max(best, 3);
    } else if (
      shorter.length >= MIN_INTERIOR_LENGTH &&
      longer.includes(shorter)
    ) {
      best = Math.max(best, 2);
    }
  }
  return best;
}

// A single merchant token sitting at the edge of a domain label, e.g.
// "victrola" in "victrolacoffee". Counted once so a multi-token merchant
// cannot stack this rule.
function tokenAffixScore(
  merchantTokens: Set<string>,
  labels: Set<string>,
): number {
  for (const token of merchantTokens) {
    if (token.length < MIN_TOKEN_AFFIX_LENGTH) continue;
    for (const label of labels) {
      if (label.startsWith(token) || label.endsWith(token)) return 2;
    }
  }
  return 0;
}

// "AMC" style: initials of a multi-word merchant spelled out as one label.
function initialsScore(
  merchantTokens: Set<string>,
  labels: Set<string>,
): number {
  if (merchantTokens.size < 3) return 0;
  const initials = [...merchantTokens].map((t) => t[0] ?? "").join("");
  return initials.length >= 3 && labels.has(initials) ? 3 : 0;
}

export function affinityScore(
  transaction: MonarchTransaction,
  entry: EmailIndexEntry,
): number {
  const merchantCompact = compactMerchant(transaction.merchant.name);
  const merchantTokens = tokenize(
    `${transaction.merchant.name} ${transaction.plaidName}`,
  );
  const labels = senderDomainLabels(entry.from);

  let score = Math.max(
    domainScore(merchantCompact, labels),
    domainScore(compactMerchant(transaction.plaidName), labels),
  );
  score += tokenAffixScore(merchantTokens, labels);
  score += initialsScore(merchantTokens, labels);

  const emailTokens = tokenize(`${entry.from} ${entry.subject}`);
  let overlap = 0;
  for (const token of merchantTokens) {
    if (emailTokens.has(token)) overlap++;
  }
  score += Math.min(overlap, MAX_TOKEN_OVERLAP_SCORE);

  if (merchantCompact.length >= MIN_AFFIX_LENGTH) {
    const subjectCompact = entry.subject
      .toLowerCase()
      .replaceAll(/[^a-z0-9]/g, "");
    if (subjectCompact.includes(merchantCompact)) score += 1;
  }

  return score;
}
