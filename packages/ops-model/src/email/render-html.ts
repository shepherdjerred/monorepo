import {
  escapeHtml,
  safeHttpUrl,
  type EmailActionLink,
  type EmailCallout,
  type EmailDetailRow,
  type EmailDocument,
  type EmailItemCard,
  type EmailMetricRow,
  type EmailSection,
  type EmailTimelineRow,
  type EmailTone,
} from "./primitives.ts";
import { HUB_EDITORIAL_PALETTE, type EditorialPalette } from "./themes.ts";

export type RenderEmailHtmlOptions = {
  /** Optional explicit scheme override (`light` | `dark`) for preview iframes. */
  forceColorScheme?: "light" | "dark";
};

function buildStylesheet(p: EditorialPalette): string {
  const toneVarsLight = Object.entries(p.tones)
    .map(
      ([tone, c]) =>
        `--t-${tone}-bg:${c.bg};--t-${tone}-ink:${c.ink};--t-${tone}-bd:${c.border};--t-${tone}-ac:${c.accent};`,
    )
    .join("");
  const toneVarsDark = Object.entries(p.tones)
    .map(
      ([tone, c]) =>
        `--t-${tone}-bg:${c.darkBg};--t-${tone}-ink:${c.darkInk};--t-${tone}-bd:${c.darkBorder};--t-${tone}-ac:${c.darkAccent};`,
    )
    .join("");
  const darkDecls = `--canvas:${p.canvasDark};--surface:${p.surfaceDark};--subtle:${p.subtleDark};--ink:${p.inkDark};--sec:${p.secondaryInkDark};--muted:${p.mutedDark};--border:${p.borderDark};--chip:${p.chipBgDark};--brand:${p.brandDark};--cta-bg:${p.ctaBgDark};--cta-ink:${p.ctaInkDark};${toneVarsDark}`;

  return [
    `:root{color-scheme:light dark;--canvas:${p.canvasLight};--surface:${p.surfaceLight};--subtle:${p.subtleLight};--ink:${p.inkLight};--sec:${p.secondaryInkLight};--muted:${p.mutedLight};--border:${p.borderLight};--chip:${p.chipBgLight};--brand:${p.brandLight};--cta-bg:${p.ctaBgLight};--cta-ink:${p.ctaInkLight};${toneVarsLight}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${darkDecls}}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${darkDecls}}`,
    `:root[data-theme="light"]{color-scheme:light;}`,
    `.e-body{background-color:var(--canvas)!important;color:var(--ink)!important;}`,
    `.e-card{background-color:var(--surface)!important;border-color:var(--border)!important;}`,
    `.e-sub{background-color:var(--subtle)!important;border-color:var(--border)!important;}`,
    `.e-ink{color:var(--ink)!important;}.e-sec{color:var(--sec)!important;}.e-muted{color:var(--muted)!important;}.e-brand{color:var(--brand)!important;}`,
    `.e-bd{border-color:var(--border)!important;}.e-next{background-color:var(--chip)!important;border-left-color:var(--brand)!important;}`,
    `.e-cta{background-color:var(--cta-bg)!important;color:var(--cta-ink)!important;}`,
    ...(["critical", "warning", "ok", "info", "neutral"] as const).map(
      (t) =>
        `.e-pill-${t}{background-color:var(--t-${t}-bg)!important;color:var(--t-${t}-ink)!important;border-color:var(--t-${t}-bd)!important;}.e-txt-${t}{color:var(--t-${t}-ink)!important;}.e-ac-${t}{border-left-color:var(--t-${t}-ac)!important;}`,
    ),
    `@media only screen and (max-width:520px){.e-pad{padding:20px 16px!important;}.e-h1{font-size:20px!important;}.e-outer{padding:12px 6px!important;}.e-dl-key{width:92px!important;}}`,
  ].join("");
}

function renderBadge(
  tone: EmailTone,
  label: string,
  p: EditorialPalette,
): string {
  const c = p.tones[tone];
  return `<span class="e-pill-${tone}" style="display:inline-block;padding:2px 9px;border-radius:999px;border:1px solid ${c.border};background:${c.bg};color:${c.ink};font-size:11.5px;font-weight:700;letter-spacing:0.02em;line-height:1.5;">${escapeHtml(label)}</span>`;
}

function renderNextStepLine(
  nextStep: string | undefined,
  p: EditorialPalette,
  compact = false,
): string {
  if (nextStep === undefined || nextStep.length === 0) return "";
  const margin = compact ? "10px 0 0" : "12px 0 0";
  const pad = compact ? "8px 11px" : "10px 13px";
  const size = compact ? "13.5px" : "14.5px";
  return `<div class="e-next e-ink" style="margin:${margin};padding:${pad};border-left:3px solid ${p.brandLight};border-radius:0 6px 6px 0;background:${p.chipBgLight};color:${p.inkLight};font-size:${size};line-height:1.5;"><strong>Next step:</strong> ${escapeHtml(nextStep)}</div>`;
}

function renderInlineLinks(
  links: readonly EmailActionLink[],
  p: EditorialPalette,
): string {
  const safe = links.flatMap((link) => {
    const href = safeHttpUrl(link.url);
    return href === null ? [] : [{ label: link.label, href }];
  });
  if (safe.length === 0) return "";
  return `<div style="margin-top:11px;font-size:13.5px;line-height:1.5;">${safe
    .map(
      (item) =>
        `<a class="e-brand" href="${escapeHtml(item.href)}" style="color:${p.brandLight};text-decoration:none;font-weight:650;">${escapeHtml(item.label)} &#8599;</a>`,
    )
    .join(
      `<span class="e-muted" style="color:${p.mutedLight};margin:0 8px;">&middot;</span>`,
    )}</div>`;
}

function renderDetailsRows(
  rows: readonly EmailDetailRow[] | undefined,
  p: EditorialPalette,
  compact = false,
): string {
  if (rows === undefined || rows.length === 0) return "";
  const fontSize = compact ? "12px" : "12.5px";
  const padY = compact ? "3px" : "4px";
  const trs = rows
    .map((row) => {
      const href = safeHttpUrl(row.url);
      const useMono = row.mono ?? href === null;
      const valFont = useMono ? `font-family:${p.fontMono};` : "";
      const valHtml =
        href === null
          ? escapeHtml(row.value)
          : `<a class="e-brand" href="${escapeHtml(href)}" style="color:${p.brandLight};text-decoration:underline;text-underline-offset:2px;">${escapeHtml(row.value)}</a>`;
      return `<tr><td class="e-muted e-dl-key" style="width:112px;padding:${padY} 12px ${padY} 0;vertical-align:top;font-size:${fontSize};font-weight:600;color:${p.mutedLight};white-space:nowrap;">${escapeHtml(row.label)}</td><td class="e-sec" style="padding:${padY} 0;vertical-align:top;${valFont}font-size:${fontSize};line-height:1.45;color:${p.secondaryInkLight};word-break:break-word;">${valHtml}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${trs}</table>`;
}

function renderCallout(callout: EmailCallout, p: EditorialPalette): string {
  const c = p.tones[callout.tone];
  const hasBody =
    callout.text !== undefined || (callout.bullets?.length ?? 0) > 0;
  const title =
    callout.title === undefined
      ? ""
      : `<div style="font-size:13.5px;font-weight:700;margin-bottom:${hasBody ? "5px" : "0"};">${escapeHtml(callout.title)}</div>`;
  const text =
    callout.text === undefined
      ? ""
      : `<p style="margin:0;font-size:14px;line-height:1.55;">${escapeHtml(callout.text)}</p>`;
  const bullets =
    callout.bullets === undefined || callout.bullets.length === 0
      ? ""
      : `<ul style="margin:${callout.text === undefined ? "0" : "5px 0 0"};padding-left:18px;font-size:14px;line-height:1.55;">${callout.bullets
          .map((item) => `<li style="margin:3px 0;">${escapeHtml(item)}</li>`)
          .join("")}</ul>`;
  return `<div class="e-pill-${callout.tone}" style="margin:14px 0 0;padding:12px 14px;border-radius:8px;border:1px solid ${c.border};border-left:3px solid ${c.accent};background:${c.bg};color:${c.ink};">${title}${text}${bullets}</div>`;
}

function renderItemCard(item: EmailItemCard, p: EditorialPalette): string {
  const c = p.tones[item.tone];
  const headerLeft =
    item.kicker === undefined
      ? renderBadge(item.tone, item.badge, p)
      : `<span class="e-sec" style="font-size:12.5px;font-weight:700;color:${p.secondaryInkLight};margin-right:8px;">${escapeHtml(item.kicker)}</span>${renderBadge(item.tone, item.badge, p)}`;
  const body =
    item.body === undefined || item.body.length === 0
      ? ""
      : `<p class="e-sec" style="margin:7px 0 0;font-size:14.5px;line-height:1.55;color:${p.secondaryInkLight};">${escapeHtml(item.body)}</p>`;
  const nextHtml = renderNextStepLine(item.nextStep, p, true);
  const linksHtml = renderInlineLinks(item.links ?? [], p);
  const detailsHtml =
    item.details === undefined || item.details.length === 0
      ? ""
      : `<div class="e-bd" style="margin-top:11px;padding-top:9px;border-top:1px solid ${p.borderLight};">${renderDetailsRows(item.details, p, true)}</div>`;

  return `<div class="e-sub e-ac-${item.tone}" style="margin:0 0 12px;padding:14px 16px;border:1px solid ${p.borderLight};border-left:3px solid ${c.accent};border-radius:8px;background:${p.subtleLight};"><div>${headerLeft}</div><div class="e-ink" style="margin-top:6px;font-size:16px;font-weight:700;line-height:1.36;color:${p.inkLight};">${escapeHtml(item.title)}</div>${body}${nextHtml}${linksHtml}${detailsHtml}</div>`;
}

function sectionHeading(text: string, p: EditorialPalette): string {
  return `<h2 class="e-muted" style="margin:22px 0 10px;font-size:11.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${p.mutedLight};">${escapeHtml(text)}</h2>`;
}

function renderMetricsTable(
  heading: string,
  rows: readonly EmailMetricRow[],
  p: EditorialPalette,
): string {
  if (rows.length === 0) return "";
  const trs = rows
    .map((row) => {
      const deltaClass =
        row.deltaTone === "good"
          ? "e-txt-ok"
          : row.deltaTone === "bad"
            ? "e-txt-critical"
            : "e-muted";
      const deltaColor =
        row.deltaTone === "good"
          ? p.tones.ok.ink
          : row.deltaTone === "bad"
            ? p.tones.critical.ink
            : p.mutedLight;
      return `<tr><td class="e-ink e-bd" style="padding:8px 8px 8px 0;border-bottom:1px solid ${p.borderLight};font-size:14.5px;color:${p.inkLight};">${escapeHtml(row.label)}</td><td class="e-ink e-bd" style="padding:8px 0;border-bottom:1px solid ${p.borderLight};text-align:right;font-family:${p.fontMono};font-size:13.5px;font-weight:700;color:${p.inkLight};white-space:nowrap;">${escapeHtml(row.value)}</td><td class="${deltaClass} e-bd" style="padding:8px 0 8px 12px;border-bottom:1px solid ${p.borderLight};text-align:right;font-family:${p.fontMono};font-size:12.5px;color:${deltaColor};white-space:nowrap;">${escapeHtml(row.delta ?? "—")}</td></tr>`;
    })
    .join("");
  return `${sectionHeading(heading, p)}<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${trs}</table>`;
}

function renderTimelineTable(
  heading: string,
  emptyText: string,
  rows: readonly EmailTimelineRow[],
  p: EditorialPalette,
): string {
  const head = sectionHeading(heading, p);
  if (rows.length === 0) {
    return `${head}<p class="e-muted" style="margin:0;font-size:14px;color:${p.mutedLight};">${escapeHtml(emptyText)}</p>`;
  }
  const trs = rows
    .map((row) => {
      const href = safeHttpUrl(row.url);
      const titleHtml =
        href === null
          ? escapeHtml(row.title)
          : `<a class="e-ink" href="${escapeHtml(href)}" style="color:${p.inkLight};text-decoration:underline;text-underline-offset:2px;">${escapeHtml(row.title)}</a>`;
      return `<tr><td class="e-muted e-bd" style="padding:7px 10px 7px 0;border-bottom:1px solid ${p.borderLight};font-family:${p.fontMono};font-size:12px;color:${p.mutedLight};white-space:nowrap;vertical-align:top;">${escapeHtml(row.time)}</td><td class="e-muted e-bd" style="padding:7px 10px 7px 0;border-bottom:1px solid ${p.borderLight};font-size:12.5px;font-weight:600;color:${p.mutedLight};white-space:nowrap;vertical-align:top;">${escapeHtml(row.kind)}</td><td class="e-ink e-bd" style="padding:7px 0;border-bottom:1px solid ${p.borderLight};font-size:14px;line-height:1.45;color:${p.inkLight};">${titleHtml}</td></tr>`;
    })
    .join("");
  return `${head}<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${trs}</table>`;
}

function renderChecksBlock(
  section: Extract<EmailSection, { kind: "checks" }>,
  p: EditorialPalette,
): string {
  const attention = section.attentionChecks
    .map((check) =>
      renderItemCard(
        {
          tone: check.status === "problem" ? "critical" : "neutral",
          badge: check.status === "problem" ? "Problem" : "Not checked",
          title: check.label,
          body: check.summary,
          ...(check.links === undefined ? {} : { links: check.links }),
        },
        p,
      ),
    )
    .join("");
  const passedSummary =
    section.passedLabels.length === 0
      ? ""
      : `<div class="e-sub" style="padding:10px 13px;border:1px solid ${p.borderLight};border-radius:7px;background:${p.subtleLight};font-size:13.5px;line-height:1.5;"><strong class="e-txt-ok" style="color:${p.tones.ok.ink};">&#10003; ${String(section.passedLabels.length)} checks passed:</strong> <span class="e-muted" style="color:${p.mutedLight};">${section.passedLabels.map((l) => escapeHtml(l)).join(" &middot; ")}</span></div>`;
  return `${sectionHeading(section.heading, p)}${attention}${passedSummary}`;
}

function renderProseBlock(
  section: Extract<EmailSection, { kind: "prose" }>,
  p: EditorialPalette,
): string {
  const paragraphs = (section.paragraphs ?? [])
    .map(
      (line) =>
        `<p class="e-sec" style="margin:0 0 8px;font-size:14.5px;line-height:1.55;color:${p.secondaryInkLight};">${escapeHtml(line)}</p>`,
    )
    .join("");
  const bullets =
    section.bullets === undefined || section.bullets.length === 0
      ? ""
      : `<ul class="e-sec" style="margin:4px 0 0;padding-left:18px;font-size:14px;line-height:1.55;color:${p.secondaryInkLight};">${section.bullets.map((b) => `<li style="margin:4px 0;">${escapeHtml(b)}</li>`).join("")}</ul>`;
  return `${sectionHeading(section.heading, p)}${paragraphs}${bullets}`;
}

function renderSection(section: EmailSection, p: EditorialPalette): string {
  switch (section.kind) {
    case "items": {
      const head =
        section.heading === undefined ? "" : sectionHeading(section.heading, p);
      if (section.items.length === 0) {
        return section.emptyText === undefined
          ? ""
          : `${head}<p class="e-muted" style="margin:0;font-size:14px;color:${p.mutedLight};">${escapeHtml(section.emptyText)}</p>`;
      }
      const omitted =
        section.omittedNotice === undefined
          ? ""
          : `<p class="e-muted" style="margin:8px 0 0;font-size:13px;color:${p.mutedLight};">${escapeHtml(section.omittedNotice)}</p>`;
      return `${head}${section.items.map((item) => renderItemCard(item, p)).join("")}${omitted}`;
    }
    case "metrics":
      return renderMetricsTable(section.heading, section.rows, p);
    case "timeline":
      return renderTimelineTable(
        section.heading,
        section.emptyText,
        section.rows,
        p,
      );
    case "checks":
      return renderChecksBlock(section, p);
    case "prose":
      return renderProseBlock(section, p);
  }
}

function renderActionBar(doc: EmailDocument, p: EditorialPalette): string {
  const primaryHref = safeHttpUrl(doc.primaryAction?.url);
  const secondary = (doc.secondaryActions ?? []).flatMap((item) => {
    const href = safeHttpUrl(item.url);
    return href === null ? [] : [{ label: item.label, href }];
  });
  if (primaryHref === null && secondary.length === 0) return "";

  const primaryHtml =
    primaryHref === null || doc.primaryAction === undefined
      ? ""
      : `<a class="e-cta" href="${escapeHtml(primaryHref)}" style="display:inline-block;margin:0 14px 6px 0;padding:9px 16px;border-radius:7px;background:${p.ctaBgLight};color:${p.ctaInkLight};font-size:14px;font-weight:650;text-decoration:none;">${escapeHtml(doc.primaryAction.label)} &#8594;</a>`;

  const secondaryHtml = secondary
    .map(
      (item) =>
        `<a class="e-brand" href="${escapeHtml(item.href)}" style="display:inline-block;margin:0 12px 6px 0;color:${p.brandLight};font-size:13.5px;font-weight:600;text-decoration:underline;text-underline-offset:2px;">${escapeHtml(item.label)}</a>`,
    )
    .join("");

  return `<div style="margin-top:18px;">${primaryHtml}${secondaryHtml}</div>`;
}

function renderTechnicalDetailsFooter(
  doc: EmailDocument,
  p: EditorialPalette,
): string {
  const hasDetails = (doc.details?.length ?? 0) > 0;
  const omitted =
    doc.omittedNotice === undefined
      ? ""
      : `<p class="e-muted" style="margin:0 0 ${hasDetails ? "10px" : "0"};font-size:13px;color:${p.mutedLight};">${escapeHtml(doc.omittedNotice)}</p>`;
  if (!hasDetails && omitted.length === 0) return "";
  const heading = hasDetails
    ? `<div class="e-muted" style="margin-bottom:8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${p.mutedLight};">Technical details</div>`
    : "";
  return `<footer class="e-bd" style="margin-top:22px;padding-top:16px;border-top:1px solid ${p.borderLight};">${omitted}${heading}${renderDetailsRows(doc.details, p)}</footer>`;
}

export function renderEmailHtml(
  doc: EmailDocument,
  options: RenderEmailHtmlOptions = {},
): string {
  const p = HUB_EDITORIAL_PALETTE;
  const topTone = p.tones[doc.tone];
  const themeAttr =
    options.forceColorScheme === undefined
      ? ""
      : ` data-theme="${options.forceColorScheme}"`;
  const metaScheme = options.forceColorScheme ?? "light dark";
  const actionsAbove = doc.actionsAboveSections ?? true;

  const preheaderHtml = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;">${escapeHtml(doc.preheader)}${"&#847; &zwnj; &nbsp; ".repeat(18)}</div>`;
  const headerBar = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><span class="e-muted" style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${p.mutedLight};">${escapeHtml(doc.eyebrow)}</span>${renderBadge(doc.tone, doc.badge, p)}</div>`;
  const headingHtml = `<h1 class="e-ink e-h1" style="margin:0;font-size:22px;font-weight:700;line-height:1.28;letter-spacing:-0.015em;color:${p.inkLight};">${escapeHtml(doc.heading)}</h1>`;
  const leadHtml =
    doc.lead === undefined
      ? ""
      : `<p class="e-sec" style="margin:10px 0 0;font-size:15.5px;line-height:1.55;color:${p.secondaryInkLight};">${escapeHtml(doc.lead)}</p>`;
  const nextStepHtml = renderNextStepLine(doc.nextStep, p);
  const calloutHtml =
    doc.callout === undefined ? "" : renderCallout(doc.callout, p);
  const actionsHtml = renderActionBar(doc, p);
  const sectionsHtml = doc.sections
    .map((section) => renderSection(section, p))
    .join("");

  const innerContent = actionsAbove
    ? `${headerBar}${headingHtml}${leadHtml}${nextStepHtml}${calloutHtml}${actionsHtml}${sectionsHtml}${renderTechnicalDetailsFooter(doc, p)}`
    : `${headerBar}${headingHtml}${leadHtml}${nextStepHtml}${calloutHtml}${sectionsHtml}${actionsHtml}${renderTechnicalDetailsFooter(doc, p)}`;

  const containerStyle = `width:100%;max-width:${String(p.maxWidthPx)}px;margin:0 auto;background:${p.surfaceLight};border:1px solid ${p.borderLight};border-top:3px solid ${topTone.accent};border-radius:10px;`;

  return [
    "<!DOCTYPE html>",
    `<html lang="en"${themeAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="${metaScheme}"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(doc.heading)}</title><style>${buildStylesheet(p)}</style></head>`,
    `<body class="e-body" style="margin:0;padding:0;background:${p.canvasLight};color:${p.inkLight};font-family:${p.fontSans};-webkit-font-smoothing:antialiased;">`,
    preheaderHtml,
    `<main><div class="e-outer" style="padding:24px 12px;"><div class="e-card" style="${containerStyle}"><div class="e-pad" style="padding:24px 26px;">${innerContent}</div></div></div></main>`,
    "</body></html>",
  ].join("");
}
