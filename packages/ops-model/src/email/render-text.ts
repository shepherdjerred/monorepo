import {
  safeHttpUrl,
  type EmailCallout,
  type EmailCheckItem,
  type EmailDetailRow,
  type EmailDocument,
  type EmailItemCard,
  type EmailSection,
  type EmailTimelineRow,
} from "./primitives.ts";

function renderDetailsText(
  rows: readonly EmailDetailRow[] | undefined,
  indent = "",
): string[] {
  if (rows === undefined || rows.length === 0) return [];
  return rows.map((row) => {
    const href = safeHttpUrl(row.url);
    const val =
      href === null
        ? row.value
        : row.value === href
          ? href
          : `${row.value} (${href})`;
    return `${indent}${row.label}: ${val}`;
  });
}

function renderItemText(item: EmailItemCard): string[] {
  const kicker = item.kicker === undefined ? "" : ` ${item.kicker} —`;
  const lines = [`- [${item.badge}]${kicker} ${item.title}`];
  if (item.body !== undefined && item.body.length > 0) {
    lines.push(`  ${item.body}`);
  }
  if (item.nextStep !== undefined && item.nextStep.length > 0) {
    lines.push(`  Next step: ${item.nextStep}`);
  }
  lines.push(...renderDetailsText(item.details, "  "));
  for (const link of item.links ?? []) {
    const href = safeHttpUrl(link.url);
    if (href !== null) lines.push(`  ${link.label}: ${href}`);
  }
  return lines;
}

function renderItemsSectionText(
  section: Extract<EmailSection, { kind: "items" }>,
): string[] {
  if (section.items.length === 0 && section.emptyText === undefined) {
    return [];
  }
  const lines = [
    "",
    ...(section.heading === undefined ? [] : [section.heading]),
    ...(section.items.length === 0
      ? [`  ${section.emptyText ?? ""}`]
      : section.items.flatMap((item) => renderItemText(item))),
  ];
  if (section.omittedNotice !== undefined) {
    lines.push(`  ${section.omittedNotice}`);
  }
  return lines;
}

function renderTimelineSectionText(
  heading: string,
  emptyText: string,
  rows: readonly EmailTimelineRow[],
): string[] {
  return [
    "",
    heading,
    ...(rows.length === 0
      ? [`  ${emptyText}`]
      : rows.map((row) => {
          const suffix =
            safeHttpUrl(row.url) === null ? "" : ` <${row.url ?? ""}>`;
          return `- ${row.time} · ${row.kind} · ${row.title}${suffix}`;
        })),
  ];
}

function renderChecksSectionText(
  heading: string,
  attentionChecks: readonly EmailCheckItem[],
  passedLabels: readonly string[],
): string[] {
  const lines = ["", heading];
  for (const check of attentionChecks) {
    const tag = check.status === "problem" ? "Problem" : "Not checked";
    lines.push(`- [${tag}] ${check.label}: ${check.summary}`);
    for (const link of check.links ?? []) {
      const href = safeHttpUrl(link.url);
      if (href !== null) lines.push(`  ${link.label}: ${href}`);
    }
  }
  if (passedLabels.length > 0) {
    lines.push(
      `- ${String(passedLabels.length)} checks passed: ${passedLabels.join(", ")}`,
    );
  }
  return lines;
}

function renderSectionText(section: EmailSection): string[] {
  switch (section.kind) {
    case "items":
      return renderItemsSectionText(section);
    case "metrics":
      return section.rows.length === 0
        ? []
        : [
            "",
            section.heading,
            ...section.rows.map(
              (row) =>
                `- ${row.label}: ${row.value}${row.delta === undefined ? "" : ` (${row.delta})`}`,
            ),
          ];
    case "timeline":
      return renderTimelineSectionText(
        section.heading,
        section.emptyText,
        section.rows,
      );
    case "checks":
      return renderChecksSectionText(
        section.heading,
        section.attentionChecks,
        section.passedLabels,
      );
    case "prose":
      return [
        "",
        section.heading,
        ...(section.paragraphs ?? []),
        ...(section.bullets ?? []).map((bullet) => `- ${bullet}`),
      ];
  }
}

function renderCalloutText(callout: EmailCallout | undefined): string[] {
  if (callout === undefined) return [];
  return [
    "",
    ...(callout.title === undefined ? [] : [callout.title]),
    ...(callout.text === undefined ? [] : [callout.text]),
    ...(callout.bullets ?? []).map((bullet) => `- ${bullet}`),
  ];
}

function renderActionLinesText(doc: EmailDocument): string[] {
  const actions = [
    ...(doc.primaryAction === undefined ? [] : [doc.primaryAction]),
    ...(doc.secondaryActions ?? []),
  ];
  const valid = actions.flatMap((action) => {
    const href = safeHttpUrl(action.url);
    return href === null ? [] : [`${action.label}: ${href}`];
  });
  return valid.length === 0 ? [] : ["", ...valid];
}

export function renderEmailText(doc: EmailDocument): string {
  const actionLines = renderActionLinesText(doc);
  const actionsAbove = doc.actionsAboveSections ?? true;
  const lines: string[] = [
    `${doc.eyebrow} · ${doc.badge}`,
    doc.heading,
    ...(doc.lead === undefined ? [] : ["", doc.lead]),
    ...(doc.nextStep === undefined ? [] : [`Next step: ${doc.nextStep}`]),
    ...renderCalloutText(doc.callout),
    ...(actionsAbove ? actionLines : []),
    ...doc.sections.flatMap((section) => renderSectionText(section)),
    ...(actionsAbove ? [] : actionLines),
    ...(doc.omittedNotice === undefined ? [] : ["", doc.omittedNotice]),
    ...((doc.details?.length ?? 0) > 0
      ? ["", "Technical details", ...renderDetailsText(doc.details)]
      : []),
  ];
  return `${lines.join("\n")}\n`;
}
