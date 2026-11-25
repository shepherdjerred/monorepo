import type {
  NormalizedBreadcrumb,
  NormalizedException,
  NormalizedSentryEvent,
  NormalizedStackFrame,
} from "#domain/envelope-normalize.ts";
import { normalizeSentryEventPayload } from "#domain/envelope-normalize.ts";
import { extractIssueSummary } from "#domain/fingerprint.ts";
import type {
  BreadcrumbView,
  ExceptionView,
  StackFrameView,
} from "#shared/contract.ts";

const MAX_MARKDOWN_BREADCRUMBS = 15;

export type ExtractedEventDetailViews = {
  readonly exceptions: ExceptionView[];
  readonly breadcrumbs: BreadcrumbView[];
  readonly tags: Record<string, string>;
  readonly contexts: Record<string, unknown>;
  readonly request: Record<string, unknown> | null;
  readonly sdk: {
    readonly name: string | null;
    readonly version: string | null;
  } | null;
};

function renderFrameSourceBlock(frame: NormalizedStackFrame): string {
  const hasContext =
    frame.contextLine !== null ||
    frame.preContext.length > 0 ||
    frame.postContext.length > 0;
  if (!hasContext) {
    return "_no source context available_";
  }

  const targetLine = frame.lineno ?? frame.preContext.length + 1;
  const startLine = Math.max(1, targetLine - frame.preContext.length);
  const endLine = targetLine + frame.postContext.length;
  const padWidth = String(endLine).length;

  const lines: string[] = ["```"];
  for (const [index, preLine] of frame.preContext.entries()) {
    const lineNum = String(startLine + index).padStart(padWidth, " ");
    lines.push(`  ${lineNum} | ${preLine}`);
  }
  if (frame.contextLine !== null) {
    const lineNum = String(targetLine).padStart(padWidth, " ");
    lines.push(`> ${lineNum} | ${frame.contextLine}`);
  }
  for (const [index, postLine] of frame.postContext.entries()) {
    const lineNum = String(targetLine + 1 + index).padStart(padWidth, " ");
    lines.push(`  ${lineNum} | ${postLine}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function renderFrameSection(frame: NormalizedStackFrame): string {
  const location =
    frame.filename ?? frame.module ?? frame.absPath ?? "<anonymous>";
  const linePart = frame.lineno === null ? "" : `:${String(frame.lineno)}`;
  const fnName = frame.function ?? "<anonymous>";
  const inAppSuffix = frame.inApp ? " [in-app]" : "";
  const heading = `### ${location}${linePart} in \`${fnName}\`${inAppSuffix}`;
  const parts = [heading, renderFrameSourceBlock(frame)];

  if (frame.vars !== null && Object.keys(frame.vars).length > 0) {
    parts.push(`Vars: \`${JSON.stringify(frame.vars)}\``);
  }
  return parts.join("\n\n");
}

function renderExceptionSection(
  exc: NormalizedException,
  includeSubheading: boolean,
): string {
  const sections: string[] = [];
  if (includeSubheading) {
    const subValue = exc.value.length > 0 ? `: ${exc.value}` : "";
    sections.push(`## ${exc.type}${subValue}`);
  }
  if (exc.frames.length === 0) {
    sections.push("_no stack frames recorded_");
    return sections.join("\n\n");
  }
  for (const frame of exc.frames) {
    sections.push(renderFrameSection(frame));
  }
  return sections.join("\n\n");
}

function renderMetadataLine(event: NormalizedSentryEvent): string | null {
  const fields: string[] = [];
  if (event.release !== null) {
    fields.push(`release: \`${event.release}\``);
  }
  if (event.environment !== null) {
    fields.push(`environment: \`${event.environment}\``);
  }
  if (event.platform !== null) {
    fields.push(`platform: \`${event.platform}\``);
  }
  if (event.transaction.length > 0) {
    fields.push(`transaction: \`${event.transaction}\``);
  }
  return fields.length > 0 ? fields.join(" | ") : null;
}

function formatBreadcrumbLine(crumb: NormalizedBreadcrumb): string {
  const ts = crumb.timestamp ?? "unknown-time";
  const category = crumb.category ?? crumb.type ?? "default";
  const level = crumb.level ?? "info";
  const message = crumb.message ?? "";
  const dataSuffix =
    crumb.data !== null && Object.keys(crumb.data).length > 0
      ? ` \`${JSON.stringify(crumb.data)}\``
      : "";
  const body = message.length > 0 ? ` ${message}` : "";
  return `- [${ts}] (${category}/${level})${body}${dataSuffix}`;
}

export function renderStacktraceMarkdown(event: NormalizedSentryEvent): string {
  const summary = extractIssueSummary(event);
  const blocks: string[] = [
    summary.value.length > 0
      ? `# ${summary.type}\n${summary.value}`
      : `# ${summary.type}`,
  ];

  const metadata = renderMetadataLine(event);
  if (metadata !== null) {
    blocks.push(metadata);
  }

  const multipleExceptions = event.exceptions.length > 1;
  for (const exc of event.exceptions) {
    blocks.push(renderExceptionSection(exc, multipleExceptions));
  }

  const tagEntries = Object.entries(event.tags).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (tagEntries.length > 0) {
    const tagLines = ["## Tags"];
    for (const [key, val] of tagEntries) {
      tagLines.push(`- \`${key}\`: \`${val}\``);
    }
    blocks.push(tagLines.join("\n"));
  }

  if (event.breadcrumbs.length > 0) {
    const recent = event.breadcrumbs.slice(-MAX_MARKDOWN_BREADCRUMBS);
    const crumbLines = ["## Breadcrumbs"];
    for (const crumb of recent) {
      crumbLines.push(formatBreadcrumbLine(crumb));
    }
    blocks.push(crumbLines.join("\n"));
  }

  return `${blocks.join("\n\n")}\n`;
}

function toStackFrameView(frame: NormalizedStackFrame): StackFrameView {
  return {
    filename: frame.filename,
    module: frame.module,
    function: frame.function,
    lineno: frame.lineno,
    colno: frame.colno,
    inApp: frame.inApp,
    preContext: [...frame.preContext],
    contextLine: frame.contextLine,
    postContext: [...frame.postContext],
    vars: frame.vars,
  };
}

export function extractEventDetailViews(
  rawData: Record<string, unknown>,
): ExtractedEventDetailViews {
  const normalized = normalizeSentryEventPayload(rawData);
  const exceptions: ExceptionView[] = normalized.exceptions.map((exc) => ({
    type: exc.type,
    value: exc.value,
    mechanismType: exc.mechanismType,
    handled: exc.handled,
    frames: exc.frames.map((frame) => toStackFrameView(frame)),
  }));
  const breadcrumbs: BreadcrumbView[] = normalized.breadcrumbs.map((crumb) => ({
    timestamp: crumb.timestamp,
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    message: crumb.message,
    data: crumb.data,
  }));
  return {
    exceptions,
    breadcrumbs,
    tags: normalized.tags,
    contexts: normalized.contexts,
    request: normalized.request,
    sdk:
      normalized.sdk === null
        ? null
        : { name: normalized.sdk.name, version: normalized.sdk.version },
  };
}
