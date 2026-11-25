import {
  TraceDetailSchema,
  type ArchiveEnvelopeRefView,
  type TraceDetail,
  type TraceSource,
  type TraceSubject,
  type TrajectoryItem,
  type WaterfallSpan,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import { extractCodexGroups, isCodexSystem } from "./trajectory-codex.ts";
import {
  buildLeafTrajectoryItem,
  isEmbedSpan,
  messagesContainToolCall,
  readSpanNumber,
  readSpanString,
} from "./trajectory-leaf.ts";
import type { InternalSpan } from "./trajectory-spans.ts";

function isToolExecutionSpan(span: InternalSpan): boolean {
  return (
    span.attributes["gen_ai.operation.name"] === "execute_tool" ||
    span.name.startsWith("execute_tool ") ||
    span.name.startsWith("ai.toolCall")
  );
}

function isCandidateLlmSpan(span: InternalSpan): boolean {
  return (
    !isToolExecutionSpan(span) &&
    (isEmbedSpan(span) ||
      isCodexSystem(span.attributes) ||
      Object.keys(span.attributes).some(
        (key) => key.startsWith("gen_ai.") || key.startsWith("ai."),
      ) ||
      span.attributes["llm.call_site"] !== undefined)
  );
}

function ancestorChain(
  span: InternalSpan,
  byId: ReadonlyMap<string, InternalSpan>,
): InternalSpan[] {
  const chain: InternalSpan[] = [];
  const seen = new Set<string>([span.spanId]);
  let parentId = span.parentSpanId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) {
      break;
    }
    chain.push(parent);
    parentId = parent.parentSpanId;
  }
  return chain;
}

function buildWaterfallAndTree(spans: readonly InternalSpan[]): {
  orderedSpans: InternalSpan[];
  waterfall: WaterfallSpan[];
  childrenByParent: Map<string, InternalSpan[]>;
  byId: Map<string, InternalSpan>;
} {
  const byId = new Map<string, InternalSpan>();
  for (const s of spans) {
    byId.set(s.spanId, s);
  }
  const childrenByParent = new Map<string, InternalSpan[]>();
  const roots: InternalSpan[] = [];

  for (const s of spans) {
    if (s.parentSpanId === null || !byId.has(s.parentSpanId)) {
      roots.push(s);
    } else {
      const list = childrenByParent.get(s.parentSpanId) ?? [];
      list.push(s);
      childrenByParent.set(s.parentSpanId, list);
    }
  }

  const sortSpans = (list: InternalSpan[]): void => {
    list.sort(
      (a, b) =>
        a.startedAtMs - b.startedAtMs || a.spanId.localeCompare(b.spanId),
    );
  };
  sortSpans(roots);
  for (const children of childrenByParent.values()) {
    sortSpans(children);
  }

  const traceStartMs =
    spans.length === 0 ? 0 : Math.min(...spans.map((s) => s.startedAtMs));
  const orderedSpans: InternalSpan[] = [];
  const waterfall: WaterfallSpan[] = [];
  const visited = new Set<string>();

  const visit = (span: InternalSpan, depth: number): void => {
    if (visited.has(span.spanId)) {
      return;
    }
    visited.add(span.spanId);
    orderedSpans.push(span);
    waterfall.push({
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      depth,
      name: span.name,
      service: span.service,
      scopeName: span.scopeName,
      startedAtMs: span.startedAtMs,
      offsetMs: Math.max(0, span.startedAtMs - traceStartMs),
      durationMs: Math.max(0, span.endedAtMs - span.startedAtMs),
      status: span.status,
      statusMessage: span.statusMessage,
      isLlmSpan: isCandidateLlmSpan(span),
      attributes: { ...span.attributes },
      resourceAttributes: { ...span.resourceAttributes },
      events: [...span.events],
    });
    for (const child of childrenByParent.get(span.spanId) ?? []) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }
  for (const orphan of spans) {
    if (!visited.has(orphan.spanId)) {
      visit(orphan, 0);
    }
  }

  return { orderedSpans, waterfall, childrenByParent, byId };
}

function buildArchiveRefs(
  orderedSpans: readonly InternalSpan[],
): ArchiveEnvelopeRefView[] {
  const refs: ArchiveEnvelopeRefView[] = [];
  for (const span of orderedSpans) {
    if (span.archiveKey === null) {
      continue;
    }
    const provider =
      readSpanString(span.attributes, "gen_ai.system") ??
      readSpanString(span.attributes, "gen_ai.provider.name") ??
      "unknown";
    const bytesComp = readSpanNumber(
      span.attributes,
      "llm.archive.bytes_compressed",
    );
    const bytesUncomp = readSpanNumber(
      span.attributes,
      "llm.archive.bytes_uncompressed",
    );
    refs.push({
      spanId: span.spanId,
      spanName: span.name,
      service: readSpanString(span.attributes, "llm.service") ?? span.service,
      provider,
      s3Bucket:
        readSpanString(span.attributes, "llm.archive.s3_bucket") ?? null,
      s3Key: span.archiveKey,
      sha256: readSpanString(span.attributes, "llm.archive.sha256") ?? null,
      bytesCompressed: bytesComp === undefined ? null : Math.trunc(bytesComp),
      bytesUncompressed:
        bytesUncomp === undefined ? null : Math.trunc(bytesUncomp),
      status: readSpanString(span.attributes, "llm.archive.status") ?? "ok",
    });
  }
  return refs;
}

function findSubjectAndWorkflow(orderedSpans: readonly InternalSpan[]): {
  subject: TraceSubject | null;
  temporalWorkflowId: string | null;
  environment: string | null;
} {
  let subject: TraceSubject | null = null;
  let temporalWorkflowId: string | null = null;
  let environment: string | null = null;

  for (const span of orderedSpans) {
    if (subject === null) {
      const kind = readSpanString(span.attributes, "llm.subject.kind");
      const id = readSpanString(span.attributes, "llm.subject.id");
      if (kind !== undefined && id !== undefined) {
        subject = { kind, id };
      }
    }
    temporalWorkflowId ??=
      readSpanString(span.attributes, "temporalWorkflowId") ??
      readSpanString(span.attributes, "workflow.id") ??
      readSpanString(span.attributes, "temporal.workflow.id") ??
      readSpanString(span.resourceAttributes, "temporalWorkflowId") ??
      null;
    environment ??=
      readSpanString(span.resourceAttributes, "deployment.environment.name") ??
      readSpanString(span.resourceAttributes, "deployment.environment") ??
      readSpanString(span.attributes, "deployment.environment.name") ??
      readSpanString(span.attributes, "deployment.environment") ??
      readSpanString(span.attributes, "environment") ??
      null;
  }

  return { subject, temporalWorkflowId, environment };
}

function detectRepairLeafIds(
  leafSpans: readonly InternalSpan[],
  wrapperIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, InternalSpan>,
  builtById: ReadonlyMap<string, TrajectoryItem>,
): Set<string> {
  const leavesByGroup = new Map<string, InternalSpan[]>();
  for (const leaf of leafSpans) {
    const outerWrapper = [...ancestorChain(leaf, byId)]
      .reverse()
      .find((a) => wrapperIds.has(a.spanId));
    const groupKey = outerWrapper?.spanId ?? leaf.parentSpanId ?? leaf.spanId;
    const list = leavesByGroup.get(groupKey) ?? [];
    list.push(leaf);
    leavesByGroup.set(groupKey, list);
  }

  const repairLeafIds = new Set<string>();
  for (const group of leavesByGroup.values()) {
    for (let idx = 1; idx < group.length; idx += 1) {
      const prev = group[idx - 1];
      const curr = group[idx];
      const prevBuilt =
        prev === undefined ? undefined : builtById.get(prev.spanId);
      const prevWasToolStep =
        prevBuilt?.shape === "ai-sdk-chat" &&
        messagesContainToolCall(
          prevBuilt.outputMessages,
          prevBuilt.finishReasons,
        );
      if (curr !== undefined && !prevWasToolStep) {
        repairLeafIds.add(curr.spanId);
      }
    }
  }
  return repairLeafIds;
}

function selectLeafTrajectoryItems(
  orderedSpans: readonly InternalSpan[],
  consumedSpanIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, InternalSpan>,
): TrajectoryItem[] {
  const nonCodexCandidates = orderedSpans.filter(
    (s) => !consumedSpanIds.has(s.spanId) && isCandidateLlmSpan(s),
  );
  const candidateIds = new Set(nonCodexCandidates.map((s) => s.spanId));
  const wrapperIds = new Set<string>();

  for (const cand of nonCodexCandidates) {
    for (const anc of ancestorChain(cand, byId)) {
      if (candidateIds.has(anc.spanId)) {
        wrapperIds.add(anc.spanId);
      }
    }
  }

  const leafSpans = nonCodexCandidates.filter((s) => !wrapperIds.has(s.spanId));
  const builtById = new Map<string, TrajectoryItem>();
  for (const leaf of leafSpans) {
    builtById.set(
      leaf.spanId,
      buildLeafTrajectoryItem(leaf, ancestorChain(leaf, byId)),
    );
  }

  const repairIds = detectRepairLeafIds(leafSpans, wrapperIds, byId, builtById);
  const items: TrajectoryItem[] = [];
  for (const leaf of leafSpans) {
    const built = builtById.get(leaf.spanId);
    if (built === undefined) {
      continue;
    }
    items.push(
      built.shape === "ai-sdk-chat" && repairIds.has(leaf.spanId)
        ? { ...built, isRepairAttempt: true }
        : built,
    );
  }
  return items;
}

function addNonEmpty(target: Set<string>, value: string | null): void {
  if (value !== null && value !== "") {
    target.add(value);
  }
}

function accumulateCost(
  item: TrajectoryItem,
  costs: {
    catalogCostUsd: number;
    notionalSubscriptionUsd: number;
    hasSubscriptionCalls: boolean;
  },
): void {
  if (item.costKind === "subscription") {
    costs.hasSubscriptionCalls = true;
    if (item.shape === "claude-agent" && item.notionalCostUsd !== null) {
      costs.notionalSubscriptionUsd += item.notionalCostUsd;
    }
  } else if (item.catalogCostUsd !== null) {
    costs.catalogCostUsd += item.catalogCostUsd;
  }
}

function summarizeTrajectory(trajectory: readonly TrajectoryItem[]): {
  workloads: string[];
  providers: string[];
  models: string[];
  totals: TraceDetail["totals"];
} {
  const workloads = new Set<string>();
  const providers = new Set<string>();
  const models = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let reasoningTokens = 0;
  const costs = {
    catalogCostUsd: 0,
    notionalSubscriptionUsd: 0,
    hasSubscriptionCalls: false,
  };

  for (const item of trajectory) {
    addNonEmpty(workloads, item.workload);
    if (item.provider !== "" && item.provider !== "unknown") {
      providers.add(item.provider);
    }
    addNonEmpty(models, item.requestedModel ?? item.responseModel);
    inputTokens += item.inputTokens;
    outputTokens += item.outputTokens;
    cachedInputTokens += item.cachedInputTokens;
    cacheCreationTokens += item.cacheCreationTokens;
    reasoningTokens += item.reasoningTokens;
    accumulateCost(item, costs);
  }

  return {
    workloads: [...workloads],
    providers: [...providers],
    models: [...models],
    totals: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationTokens,
      reasoningTokens,
      ...costs,
    },
  };
}

function computeTraceDurationMs(
  orderedSpans: readonly InternalSpan[],
  source: TraceSource,
  startedAtMs: number,
): number | null {
  if (orderedSpans.length === 0) {
    return null;
  }
  const maxEndMs = Math.max(...orderedSpans.map((s) => s.endedAtMs));
  return source === "archive" && maxEndMs === startedAtMs
    ? null
    : Math.max(0, maxEndMs - startedAtMs);
}

export function buildTraceDetailFromInternalSpans(
  traceId: string,
  source: TraceSource,
  spans: readonly InternalSpan[],
): TraceDetail {
  const { orderedSpans, waterfall, childrenByParent, byId } =
    buildWaterfallAndTree(spans);
  const codexResult = extractCodexGroups(orderedSpans, childrenByParent);
  const leafItems = selectLeafTrajectoryItems(
    orderedSpans,
    codexResult.consumedSpanIds,
    byId,
  );
  const trajectory = [...codexResult.items, ...leafItems].sort(
    (a, b) => a.startedAtMs - b.startedAtMs || a.spanId.localeCompare(b.spanId),
  );

  const startedAtMs =
    orderedSpans.length === 0
      ? 0
      : Math.min(...orderedSpans.map((s) => s.startedAtMs));
  const durationMs = computeTraceDurationMs(orderedSpans, source, startedAtMs);
  const summary = summarizeTrajectory(trajectory);
  const errorSpanCount = orderedSpans.filter(
    (s) => s.status === "error",
  ).length;
  const hasError =
    errorSpanCount > 0 || trajectory.some((t) => t.status === "error");
  const rootSpan = waterfall[0];
  const meta = findSubjectAndWorkflow(orderedSpans);

  return TraceDetailSchema.parse({
    traceId,
    source,
    startedAtMs,
    durationMs,
    rootService: rootSpan?.service ?? "unknown",
    environment: meta.environment,
    rootSpanName: rootSpan?.name ?? "unknown",
    status: hasError ? "error" : "ok",
    spanCount: waterfall.length,
    llmCallCount: trajectory.length,
    errorSpanCount,
    workloads: summary.workloads,
    providers: summary.providers,
    models: summary.models,
    subject: meta.subject,
    temporalWorkflowId: meta.temporalWorkflowId,
    totals: summary.totals,
    trajectory,
    waterfall,
    archiveRefs: buildArchiveRefs(orderedSpans),
  });
}
